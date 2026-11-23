export type LegalDocumentId = 'privacy' | 'terms';
export type LegalSection = { title: string; paragraphs: readonly string[]; showPrivacyContact?: boolean };
export type LegalDocument = {
  title: string;
  introduction: string;
  sections: readonly LegalSection[];
};

// Review versions, not effective dates or records of acceptance.
export const LEGAL_DRAFT_VERSION = '2026-11-23';
export const LEGAL_DRAFT_DATE = 'November 23, 2026';
export const LEGAL_DRAFT_NOTICE = 'For testing. Operator and final retention details are still being confirmed before launch.';

const mailbox = process.env.EXPO_PUBLIC_PRIVACY_EMAIL?.trim();
// Accept a single public recipient. A missing or malformed build setting leaves the contact unpublished.
const mailboxPattern = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
export const privacyEmail = mailbox && mailboxPattern.test(mailbox) ? mailbox : undefined;

export const legalDocuments: Record<LegalDocumentId, LegalDocument> = {
  privacy: {
    title: 'Privacy Policy',
    introduction: 'How CampusClutch uses your information and the choices you have.',
    sections: [
      { title: 'About CampusClutch', paragraphs: [
        'CampusClutch helps students find classmates, read course reviews, arrange campus help and message each other.',
        'The public operator name is being confirmed. An SFU email requirement does not mean SFU operates or endorses this app.',
      ] },
      { title: 'Request your information', showPrivacyContact: true, paragraphs: privacyEmail ? [
        'Email us to ask for a copy of your information, request a correction or raise a privacy concern. You can write to us even after deleting your account.',
        'Tell us which records you’re asking about. We may need to verify your identity before sharing them.',
      ] : ['The privacy email address will appear here once confirmed.'] },
      { title: 'Information we use', paragraphs: [
        'Your email and sign-in information let you create and access an account. Your profile can include a name, photo, major, year of study, interests and optional social links.',
        'We store the courses you add, reviews and optional grades, requests and locations you enter, offers, messages and read status, points, work history and notifications. Reports, decisions and appeals include evidence needed for review.',
        'If you enable push alerts, we register your device for delivery. The app saves sign-in state and drafts on your device. Service providers also process technical information needed to operate and secure these features.',
      ] },
      { title: 'What other students can see', paragraphs: [
        'Signed-in students can see information shared through profiles, classmates, requests and reviews. Your discovery and social-link settings control those features. Hiding your profile does not erase existing conversations or shared work.',
        'Course reviews are anonymous to other students. We retain authorship so you can manage your review and assigned staff can handle reports. Details you write may still identify you.',
        'Direct messages are available to the participants through the app. Messages are not end-to-end encrypted. Reporting a message shares captured evidence with assigned staff.',
        'Reports and appeals are private to authorized staff and the account-decision views available to the affected student.',
      ] },
      { title: 'Services that support the app', paragraphs: [
        'Supabase provides accounts, app data and photo storage. Expo provides the password-reset website and push delivery. Google Firebase Cloud Messaging delivers Android push alerts.',
        'Optional social links open the linked service. Its own privacy rules apply there. Provider locations and backup/log retention are being verified before launch; this draft does not promise Canadian-only storage.',
      ] },
      { title: 'Your choices', paragraphs: [
        'You can edit your profile, choose social-link visibility, turn off student discovery, manage push alerts, block or report students, and edit or delete your own course reviews.',
        'Turning off push alerts keeps the bell inbox available. Photo access is used when you choose a profile picture.',
      ] },
      { title: 'Deleting your account', paragraphs: [
        'Open Profile, then Delete account. Finish or cancel accepted work first. Deletion removes your profile details, photo, course memberships and source reviews, cancels open requests and withdraws pending offers.',
        'The other person can still read your past messages under Deleted student. This includes any personal details you wrote in the chat.',
        'At launch, ordinary direct messages expire 30 days after both account deletions finish. We keep conversations still needed for a report, a job or a retention hold.',
        'At launch, shared job history expires one year after the last participant finishes deleting their account, the last job activity, or the final dispute decision, whichever comes last. We keep records still needed for points, reports or holds.',
        'You can still delete your account when a record is on hold. Only assigned admins can view a private copy of the affected evidence while the hold is active. After the last hold ends, we erase the copy once related appeals, access requests and retention periods are complete. We keep the hold history.',
        'We keep a protected representation of your verified email to prevent repeat welcome bonuses. We save your remaining points so they can be restored when you return with that same verified email. You do not receive another 100-point welcome grant.',
        'Returning creates a new profile. Deleted profile data and old private chats are not restored to the new account. At launch, your saved receipt lets you check deletion status while cleanup is pending and for 90 days after it finishes.',
      ] },
      { title: 'How long information stays', paragraphs: [
        'Account information supports your use of the app. The deletion rules above describe what is removed and what remains.',
        'Requests leave the campus feed at their deadline. At launch, if your post expires without an offer, you have at least 90 days to archive it before cleanup. Reopened requests and posts needed for shared work, points, reports or holds follow separate rules.',
        'At launch, message, request and offer alerts leave your bell inbox 90 days after you first read them. Unread alerts expire 180 days after they arrive. A hold or pending delivery can keep an alert longer. Only the bell entry expires.',
        'At launch, closed reports, appeals and their evidence expire one year after the final decision or the last time the evidence was used in a decision, whichever is later. We keep what we still need for open appeals, access requests, holds, active warnings and suspensions.',
        'At launch, we keep routine records of completed background jobs for 30 days to investigate failures. We are still confirming how long our providers keep their own logs and backups.',
      ] },
      { title: 'Testing and updates', paragraphs: [
        'At launch, we check signup eligibility by sending a verification link to your @sfu.ca email address. Preview testing accepts other verified email addresses.',
        'The final policy will identify the operator, contact details and effective date. Material changes will be explained. This page is a Preview draft.',
      ] },
    ],
  },
  terms: {
    title: 'Terms',
    introduction: 'Guidelines for accounts, campus help, reviews and respectful participation.',
    sections: [
      { title: 'Using your account', paragraphs: [
        'Keep control of your account and provide accurate information. Do not impersonate students, misuse someone else’s information, or create accounts to evade restrictions or collect repeat welcome points.',
        'At launch, you can join at any age with a verified @sfu.ca email address. Preview testing accepts other verified email addresses.',
      ] },
      { title: 'Requests and points', paragraphs: [
        'Describe the help, location, timing and offered points clearly. Offer only work you can carry out safely and honestly. Follow the acceptance, completion and cancellation steps. Do not mark unfinished work complete to transfer points.',
        'Points support campus help. This version has no cash-purchase or cash-withdrawal feature. Each verified email receives 100 welcome points once. Deleting and recreating an account saves its remaining balance for a return with the same verified email; it does not create another bonus.',
        'Resolve accepted work before deleting your account. Admin removal of an active request closes the assignment and releases reserved points without paying the helper. It does not reverse unrelated completed payments.',
      ] },
      { title: 'Course reviews', paragraphs: [
        'Share your own experience respectfully. Do not identify another student, post exam answers or share private documents or content you do not have permission to use. Student-reported grades and opinions are not official university records.',
        'You can read reviews before adding a course. Writing one requires a current or past course membership in the app. Reviews are anonymous to other students, but staff can investigate reported content.',
        'You may revise a hidden review. Address the moderation feedback rather than repeating abusive content.',
      ] },
      { title: 'Respect and safety', paragraphs: [
        'Do not harass, threaten, discriminate, reveal private information without permission, send spam or scam others. Do not arrange unlawful or dangerous work, or use requests to cheat on coursework or assessments.',
        'Use blocking and reporting when needed. Reports are not an emergency service and do not guarantee an immediate response. CampusClutch cannot guarantee another student’s conduct or the availability of help.',
      ] },
      { title: 'Moderation and appeals', paragraphs: [
        'Assigned admins can remove requests, hide reviews, issue warnings or suspend accounts with a recorded reason. The affected student receives the reason in the bell inbox and Account decisions & appeals.',
        'Every three effective warnings trigger a seven-day suspension and a new warning cycle. Admins can also issue a seven-day suspension directly. Overturned warnings do not count.',
        'You can appeal through Account decisions & appeals, including while suspended. Any assigned admin, including the original decision-maker, may review the appeal. The decision is recorded and you are notified.',
        'Removing content does not erase every copy. Captured evidence can remain for moderation and appeals. The Privacy Policy explains retained information.',
      ] },
      { title: 'Closing your account', paragraphs: [
        'Open Profile, then Delete account after resolving accepted work. If the other person keeps their account, they can still read your past messages under Deleted student. A recreated account starts with an empty inbox.',
      ] },
      { title: 'Operator and support', paragraphs: [
        'These terms are a Preview draft. The published terms will name the operator, give a support contact and include an effective date.',
      ] },
    ],
  },
};
