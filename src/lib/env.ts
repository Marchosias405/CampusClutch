export type AppEnvironment = 'development' | 'preview' | 'production';

const allowedAppEnvironments = new Set<AppEnvironment>([
  'development',
  'preview',
  'production',
]);

function requirePublicValue(
  name: string,
  value: string | undefined
): string {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env.local and provide the required public configuration.`
    );
  }

  return normalizedValue;
}

function parseAppEnvironment(
  value: string | undefined
): AppEnvironment {
  const normalizedValue = requirePublicValue(
    'EXPO_PUBLIC_APP_ENV',
    value
  );

  if (
    !allowedAppEnvironments.has(
      normalizedValue as AppEnvironment
    )
  ) {
    throw new Error(
      `Invalid EXPO_PUBLIC_APP_ENV: ${normalizedValue}. Expected development, preview, or production.`
    );
  }

  return normalizedValue as AppEnvironment;
}

function parseSupabaseUrl(
  value: string | undefined
): string {
  const normalizedValue = requirePublicValue(
    'EXPO_PUBLIC_SUPABASE_URL',
    value
  );

  if (!/^https?:\/\/[^/]+/i.test(normalizedValue)) {
    throw new Error(
      'EXPO_PUBLIC_SUPABASE_URL must be a valid HTTP or HTTPS URL.'
    );
  }

  return normalizedValue.replace(/\/+$/, '');
}

const appEnvironment = parseAppEnvironment(
  process.env.EXPO_PUBLIC_APP_ENV
);

const supabaseUrl = parseSupabaseUrl(
  process.env.EXPO_PUBLIC_SUPABASE_URL
);

const supabasePublishableKey = requirePublicValue(
  'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

export const env = Object.freeze({
  appEnvironment,
  supabaseUrl,
  supabasePublishableKey,
});
