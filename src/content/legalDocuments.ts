export type LegalDocumentId = 'privacy' | 'terms';
export type LegalSection = { title: string; paragraphs: readonly string[] };
export type LegalDocument = {
  title: string;
  introduction: string;
  sections: readonly LegalSection[];
};

// Review versions, not effective dates or records of acceptance.
export const LEGAL_DRAFT_VERSION = '2026-11-18';
export const LEGAL_DRAFT_DATE = 'November 18, 2026';
export const LEGAL_DRAFT_NOTICE = 'For testing. Operator, contact and final retention details are still being confirmed before launch.';

export const legalDocuments: Record<LegalDocumentId, LegalDocument> = {
  privacy: {
    title: 'Privacy Policy',
    introduction: 'How CampusClutch uses your information and the choices you have.',
    sections: [
      { title: 'About CampusClutch', paragraphs: [
        'CampusClutch helps students find classmates, read course reviews, arrange campus help and message each other.',
        'The public operator name and privacy/support contact are being confirmed. An SFU email requirement does not mean SFU operates or endorses this app.',
      ] },
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
        'A public contact for privacy questions and access or correction requests will be listed before launch. Identity checks may be needed to protect your information and other people’s information.',
      ] },
      { title: 'Deleting your account', paragraphs: [
        'Open Profile, then Delete account. Finish or cancel accepted work first. Deletion removes your profile details, photo, course memberships and source reviews, cancels open requests and withdraws pending offers.',
        'Past messages remain in the other person’s closed conversation as Deleted student. Personal details written in those messages may remain. Limited shared job history and private safety evidence may also remain.',
        'We keep a protected representation of your verified email to prevent repeat welcome bonuses. We save your remaining points so they can be restored when you return with that same verified email. You do not receive another 100-point welcome grant.',
        'Returning creates a new profile. Deleted profile data and old private chats are not restored to the new account. If deletion is interrupted, the app lets you check its status.',
      ] },
      { title: 'How long information stays', paragraphs: [
        'Account information supports your use of the app. The deletion rules above describe what is removed and what remains.',
        'Automatic expiry for retained safety evidence and shared history is not yet in place. Retention periods and provider backup/log rules are being finalized before launch. This draft does not promise a fixed deletion deadline.',
      ] },
      { title: 'Testing and updates', paragraphs: [
        'Preview testing accepts other verified emails. Launch is planned for SFU students with an SFU email requirement. Email verification alone does not prove current enrolment.',
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
        'Launch is planned for SFU students. Preview testing accepts other verified emails. Email verification does not prove current enrolment or university endorsement. Final eligibility and operator details will be confirmed before launch.',
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
        'Open Profile, then Delete account after resolving accepted work. Past messages remain for the other participant as Deleted student. A recreated account does not inherit the old private history.',
      ] },
      { title: 'Operator and support', paragraphs: [
        'The public operator name and support contact are being confirmed. These are Preview drafts, not final launch terms. The final version will identify the operator, contact details, eligibility rules and effective date.',
      ] },
    ],
  },
};
