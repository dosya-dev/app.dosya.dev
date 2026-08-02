/**
 * Copy for the five-page welcome tour.
 *
 * Pure data, no React, so the wording is testable and the layout does not
 * have to change when the words do. Every claim here describes something the
 * product actually ships - see the security page in particular.
 */

export type TourStepId = 'welcome' | 'sharing' | 'security' | 'integrations' | 'ready';

export interface TourPoint {
  title: string;
  /** One short sentence. No em dashes. */
  body: string;
}

export interface TourStep {
  id: TourStepId;
  heading: string;
  points: TourPoint[];
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    heading: 'Welcome to dosya.dev',
    points: [
      { title: 'Upload', body: 'Drag anything in. Folders, large video files, whole archives.' },
      { title: 'Share', body: 'One link, with an expiry and a password if you want one.' },
      { title: 'Invite', body: 'Bring your team into a shared workspace with roles.' },
      { title: 'Fast', body: 'No upload caps and no download throttling on any plan.' },
    ],
  },
  {
    id: 'sharing',
    heading: 'Send files, and ask for them back',
    points: [
      { title: 'Share a link', body: 'The person you send it to opens it in a browser. No account needed.' },
      { title: 'Set the terms', body: 'Add an expiry date, a password, or limit it to certain email addresses.' },
      { title: 'Collect uploads', body: 'A file request gathers files from people into a folder you choose.' },
      { title: 'Work together', body: 'Roles decide who can upload, share, move and delete.' },
    ],
  },
  {
    // Every line here is a shipped feature. The vault's zero-knowledge
    // question is unresolved, so nothing on this page claims it.
    id: 'security',
    heading: 'Your files, on your terms',
    points: [
      { title: 'Encrypted at rest', body: 'Files are encrypted where they are stored.' },
      { title: 'Choose your region', body: 'Decide where each file physically lives.' },
      { title: 'See every action', body: 'A tamper-evident audit trail records what happened and when.' },
      { title: 'Lock your account', body: 'Two-factor authentication with an app or by email.' },
    ],
  },
  {
    id: 'integrations',
    heading: 'It fits what you already use',
    points: [
      { title: 'Mount it like a drive', body: 'WebDAV and S3 work with Finder, rclone and your own code.' },
      { title: 'Use it from the terminal', body: 'The CLI moves files and syncs folders from any shell.' },
      { title: 'Bring your data', body: 'Import straight from Google Drive without downloading first.' },
      { title: 'Paste a URL', body: 'We fetch the file into your storage for you.' },
    ],
  },
  {
    id: 'ready',
    heading: 'You are ready to go',
    points: [
      { title: 'Free forever', body: 'Your plan includes 5 GB, with no time limit.' },
      { title: 'Earn more space', body: 'Every friend who joins adds 5 GB, up to 25 GB.' },
      { title: 'Start anywhere', body: 'The web app, the desktop app, the CLI or a mounted drive.' },
    ],
  },
];
