"""Run the retention inventory or its disposable fixtures on a local Supabase container."""
import argparse
import os
from pathlib import Path
import re
import subprocess
from uuid import uuid4


HERE = Path(__file__).resolve().parent
SOCKET = "/var/run/postgresql"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("container", help="Local supabase_db_... container name")
    parser.add_argument("--test", action="store_true", help="Run fixtures in a temporary, isolated database")
    parser.add_argument("--schedule-evidence", action="store_true",
                        help="Enable the private-copy cleanup worker on this local database")
    parser.add_argument("--schedule-dms", action="store_true",
                        help="Enable cleanup of expired ordinary DMs on this local database")
    parser.add_argument("--schedule-jobs", action="store_true",
                        help="Enable cleanup of expired shared jobs on this local database")
    parser.add_argument("--schedule-cases", action="store_true",
                        help="Enable cleanup of expired closed reports and appeals on this local database")
    parser.add_argument("--schedule-bell", action="store_true",
                        help="Enable cleanup of expired ordinary bell entries on this local database")
    parser.add_argument("--schedule-receipts", action="store_true",
                        help="Erase expired deletion receipt hashes on this local database")
    parser.add_argument("--schedule-unclaimed", action="store_true",
                        help="Remove old unclaimed postings on this local database")
    parser.add_argument("--schedule-routine-logs", action="store_true",
                        help="Enable cleanup of completed Clu scheduler logs on this local database")
    args = parser.parse_args()
    if not re.fullmatch(r"supabase_db_[A-Za-z0-9_-]+", args.container):
        parser.error("Specify a local Supabase database container name.")
    endpoint = os.environ.get("DOCKER_HOST")
    if os.environ.get("DOCKER_CONTEXT") or not endpoint:
        endpoint = subprocess.check_output(
            ["docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], text=True
        ).strip()
    if not endpoint.startswith(("unix:///", "npipe:////./pipe/")):
        parser.error("Select a local Docker context for the retention dry run.")

    def docker(*command, sql=None):
        return subprocess.run(
            ["docker", "exec", "-i", args.container, *command],
            input=sql, text=True, encoding="utf-8", stdout=subprocess.PIPE, check=True
        ).stdout

    def psql(db, sql, *, plain=False):
        options = ["-qAt"] if plain else []
        return docker("psql", "-X", "-h", SOCKET, "-U", "postgres", "-d", db,
                      "-v", "ON_ERROR_STOP=1", *options, sql=sql)

    query = (HERE / "report.sql").read_text(encoding="utf-8").strip()
    wrapper = (HERE / "dry-run.sql").read_text(encoding="utf-8")
    # psql reads stdin inside Docker, so expand this one relative file include here.
    print(psql("postgres", wrapper.replace(r"\ir report.sql", query)), end="")
    if args.schedule_evidence:
        print(psql("postgres", """
            BEGIN;
            SELECT 'safety_private.erase_released_evidence()'::regprocedure;
            CREATE EXTENSION IF NOT EXISTS pg_cron;
            SELECT cron.schedule('campusclutch-released-evidence', '* * * * *',
                                 'set statement_timeout = ''5s''; select safety_private.erase_released_evidence()');
            COMMIT;"""), end="")
    if args.schedule_dms:
        print(psql("postgres", (HERE / "schedule-dms.sql").read_text(encoding="utf-8")), end="")
    if args.schedule_jobs:
        print(psql("postgres", (HERE / "schedule-jobs.sql").read_text(encoding="utf-8")), end="")
    if args.schedule_cases:
        print(psql("postgres", (HERE / "schedule-cases.sql").read_text(encoding="utf-8")), end="")
    if args.schedule_bell:
        print(psql("postgres", (HERE / "schedule-bell.sql").read_text(encoding="utf-8")), end="")
    if args.schedule_receipts:
        print(psql("postgres", (HERE / "schedule-receipts.sql").read_text(encoding="utf-8")), end="")
    if args.schedule_unclaimed:
        print(psql("postgres", (HERE / "schedule-unclaimed.sql").read_text(encoding="utf-8")), end="")
    if args.schedule_routine_logs:
        print(psql("postgres", (HERE / "schedule-routine-logs.sql").read_text(encoding="utf-8")), end="")
    if not args.test:
        return

    # Copy only column definitions, never rows, IDs, evidence, privileges or triggers.
    # Recreate the same eligibility functions over synthetic columns and rows.
    definitions = psql("postgres", """SET search_path=pg_catalog;
        SELECT format('CREATE VIEW %s AS %s',name,pg_get_viewdef(name::regclass,true))
        FROM unnest(array['safety_private.independent_thread_windows','safety_private.direct_thread_windows',
                          'safety_private.job_report_links','safety_private.report_resolutions','safety_private.job_activity',
                          'safety_private.evidence_scopes','safety_private.case_dependencies',
                          'safety_private.case_notices','safety_private.case_hold_targets',
                          'safety_private.unclaimed_request_windows'])
             WITH ORDINALITY views(name, position) ORDER BY position;
        SELECT pg_get_functiondef('account_private.deletion_receipt_expires_at(timestamptz)'::regprocedure) || ';';
        SELECT pg_get_functiondef('safety_private.ordinary_bell_deadline(text,timestamptz,timestamptz)'::regprocedure) || ';';
        SELECT 'CREATE VIEW safety_private.bell_windows AS ' || pg_get_viewdef('safety_private.bell_windows'::regclass,true);
        SELECT pg_get_functiondef('safety_private.case_windows(timestamptz,uuid)'::regprocedure) || ';';
        SELECT pg_get_functiondef('safety_private.shared_job_windows(timestamptz,uuid)'::regprocedure) || ';';
        SELECT pg_get_functiondef('safety_private.retention_source_windows(timestamptz)'::regprocedure) || ';';
        SELECT pg_get_functiondef('safety_private.evidence_cleanup_windows(timestamptz)'::regprocedure) || ';';""", plain=True)
    tables = sorted(set(re.findall(r"\b(?:FROM|JOIN)\s+\(*\s*([a-z_]+\.[a-z_]+)\b", query + definitions, re.I)) - {
        "safety_private.retention_source_windows", "safety_private.evidence_cleanup_windows", "safety_private.bell_windows",
        "safety_private.independent_thread_windows", "safety_private.direct_thread_windows",
        "safety_private.job_report_links", "safety_private.report_resolutions", "safety_private.job_activity",
        "safety_private.shared_job_windows", "safety_private.case_windows", "safety_private.evidence_scopes",
        "safety_private.case_dependencies", "safety_private.case_notices", "safety_private.case_hold_targets",
        "safety_private.unclaimed_request_windows"
    })
    schemas = sorted({name.split(".")[0] for name in tables} - {"public"})
    literals = ", ".join(f"'{name}'::regclass" for name in tables)
    ddl = psql("postgres", f"""
        BEGIN READ ONLY;
        SET LOCAL search_path = pg_catalog;
        SELECT format('CREATE TABLE %s (%s);', attrelid::regclass,
            string_agg(format('%I %s',attname,format_type(atttypid,atttypmod)), ', ' ORDER BY attnum))
        FROM pg_attribute WHERE attrelid IN ({literals}) AND attnum > 0 AND NOT attisdropped
        GROUP BY attrelid ORDER BY attrelid;
        ROLLBACK;""", plain=True)
    db = "retention_fixture_" + uuid4().hex
    docker("createdb", "-h", SOCKET, "-U", "postgres", "-T", "template0", db)
    try:
        fixtures = (HERE / "fixtures.sql").read_text(encoding="utf-8")
        test = (HERE / "assertions.sql").read_text(encoding="utf-8")
        setup = "\n".join(f"CREATE SCHEMA {schema};" for schema in schemas)
        print(psql(db, f"""
            BEGIN;
            SET LOCAL TIME ZONE 'UTC';
            {setup}
            {ddl}
            {definitions}
            {fixtures}
            CREATE TEMP VIEW retention_report AS {query}
            {test}
            ROLLBACK;""", plain=True), end="")
    finally:
        # Only the database this invocation successfully created can reach this point.
        docker("dropdb", "-h", SOCKET, "-U", "postgres", db)


if __name__ == "__main__":
    main()
