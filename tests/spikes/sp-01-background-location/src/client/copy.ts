/**
 * All user-facing spike text in one place (CLAUDE.md §10). DRAFT wording for a test build — not store copy, not
 * reviewed product copy, English only. The disclosure follows the Play "prominent disclosure" pattern: it says
 * "location", names the background use and says what is collected and when it stops.
 */
export const copy = {
  appTitle: 'Wayvro SP-01 spike',
  notForDistribution: 'Test build — not for distribution. Synthetic test account only.',
  signIn: {
    title: 'Connect to the test receiver',
    help: 'Enter the receiver address and run token shown on the laptop (same Wi-Fi).',
    url: 'Receiver address (http://192.168.x.x:8787)',
    token: 'Run token (spike-local-only-…)',
    submit: 'Connect',
    errors: {
      INVALID_URL: 'Use the form http://<laptop LAN address>:<port>.',
      INVALID_TOKEN: 'The token starts with spike-local-only-.',
      UNAUTHORISED: 'The receiver rejected this token.',
      NETWORK: 'The receiver is not reachable on this Wi-Fi.',
      TIMEOUT: 'The receiver did not answer in time.',
    } as Record<string, string>,
  },
  modes: { rider: 'Rider', driver: 'Driver' },
  riderMode: 'Rider mode: no driver permission is requested and no location service runs in this mode.',
  confirmRider: {
    title: 'Go offline first?',
    body: 'You are online as a driver. Switching to Rider mode takes you offline and stops location sharing.',
    confirm: 'Go offline and switch',
    cancel: 'Stay online',
  },
  disclosure: {
    title: 'Location while you are online',
    body:
      'This test build collects location data to check that driver tracking keeps working while you are online, ' +
      'even when the app is closed or not in use. While you are online it reads this phone’s location every few ' +
      'seconds, including in the background, and sends only timing, accuracy and distance-moved figures to the test ' +
      'laptop on your Wi-Fi. Your exact position never leaves the phone. Location sharing stops when you go offline, ' +
      'switch to Rider mode or sign out.',
    continue: 'Continue',
    notNow: 'Not now',
  },
  background: {
    title: 'Allow location all the time',
    body:
      'To keep tracking while the screen is off, Android needs “Allow all the time”. The next step opens this app’s ' +
      'location settings: choose “Allow all the time”, keep “Use precise location” on, then come back.',
    open: 'Open location settings',
    notNow: 'Not now',
  },
  recovery: {
    FOREGROUND_PERMISSION_DENIED: 'Location is not allowed, so you cannot go online. You can allow it in Settings.',
    PRECISE_LOCATION_REQUIRED: 'Only approximate location is allowed. Going online needs precise location (PRECISE_LOCATION_REQUIRED).',
    BACKGROUND_PERMISSION_DENIED: 'Location is not allowed all the time, so you cannot go online. Choose “Allow all the time” in Settings.',
    LOCATION_SERVICES_OFF: 'Location services are off on this phone. Turn them on to go online.',
    RESTRICTED: 'The server has restricted this test account. Going online is refused (RESTRICTED).',
    START_REFUSED_BACKGROUND: 'Going online must start from the app on screen. Open the app and tap Go online (START_REFUSED_BACKGROUND).',
    START_FAILED: 'The location service could not start.',
    NETWORK: 'The receiver is not reachable, so you cannot go online now.',
    openSettings: 'Open Settings',
    back: 'Back',
  } as Record<string, string>,
  notices: {
    'tracking-stopped': 'Tracking stopped — the app was closed while you were online. Go online again to resume.',
    'forced-offline': 'You are offline. Reason from the server:',
    'permission-lost': 'Location permission changed while you were online, so you were taken offline. Reason:',
    'go-online-refused': 'Going online was refused:',
    'background-start-refused': 'Background go-online attempt (TC-10):',
    'tc10-invalid': 'TC-10 attempt not valid — repeat it:',
    stopped: 'Tracking stopped:',
    resume: 'Go online again',
    goOffline: 'Stay offline',
    dismiss: 'Dismiss',
  },
  driver: {
    goOnline: 'Go online',
    goOffline: 'Go offline',
    profile: 'Location profile (offline only)',
    standard: 'Standard 5 s',
    economy: 'Economy 10 s / 10 m',
    battery: 'Request battery-optimisation exemption',
  },
  debug: {
    title: 'Test controls',
    tc10: 'TC-10: try going online from the background in 30 s (press Home now)',
    tc10Short: 'TC-10 (5 s variant for app-freezer devices; press Home now)',
    tc10Armed: 'TC-10 armed — press Home and wait',
    tc15: 'TC-15: deliberate JS crash',
  },
  signOut: {
    button: 'Sign out',
    title: 'Sign out?',
    body: 'Signing out takes you offline and clears this test build’s data.',
    confirm: 'Sign out',
    cancel: 'Cancel',
  },
} as const;
