import type { Locale } from '@wayvro/contracts';

/**
 * User-facing copy of the app (CLAUDE.md §10: no copy in components or business logic). English is the source; Urdu
 * (`ur`) and Roman Urdu (`ur-Latn`) are PROVISIONAL translations pending native-speaker review (Q29/Q30) and are
 * labelled as such in the UI. Every locale must define exactly the same keys: the catalogue is typed
 * `Record<Locale, Record<StringKey, string>>`, so a missing or extra key is a compile error; tests check non-empty
 * values, identical `{placeholders}` and forbidden wording.
 *
 * Wording rules: no identity-verification, liveness or government-database claims; no age number anywhere (the age
 * threshold, if any, comes from the server's age-eligibility policy through the `{minimumAge}` placeholder).
 */
export type UiLocale = Locale;

const en = {
  appName: 'Wayvro',

  'common.retry': 'Try again',
  'common.continue': 'Continue',
  'common.cancel': 'Cancel',
  'common.notNow': 'Not now',
  'common.loading': 'Loading…',
  'common.saving': 'Saving…',
  'common.signOut': 'Sign out',
  'common.signingOut': 'Signing out…',
  'common.placeholderNotice': 'PLACEHOLDER — NOT FOR PRODUCTION — pending counsel approval',
  'common.version': 'Version {version}',
  'common.effectiveFrom': 'Effective from {date}',
  'common.staleData': "Showing the last information we loaded. We couldn't refresh it.",
  'common.translationPending': 'Translation pending native-speaker review.',

  'error.offline': "Couldn't reach Wayvro. Check your internet connection and try again.",
  'error.rateLimited': 'Too many attempts. Try again in {seconds} seconds.',
  'error.rateLimitedNoTime': 'Too many attempts. Please wait a little and try again.',
  'error.sessionExpired': 'Your session has ended. For your security, please sign in again.',
  'error.validation': 'Please check what you entered and try again.',
  'error.conflict': 'This changed in the meantime. We refreshed it — please review and try again.',
  'error.stepUp':
    'To protect your account, this needs a recent sign-in. Sign out, sign in again on this phone, then try again. A quicker confirmation step will come in a later version.',
  'error.unavailable': 'Wayvro is temporarily unavailable. Please try again shortly.',
  'error.unknown': 'Something went wrong. Please try again.',
  'error.requiredAction': 'Please complete the required step for your account first.',
  'error.restricted': "Your account can't do this right now because of a restriction. Your account page has the details.",
  'error.featureDisabled': "This feature isn't available yet.",

  'config.title': 'Service not configured',
  'config.unconfigured': "This build of Wayvro isn't connected to a Wayvro service, so signing in is not possible.",
  'config.invalid': "This build has an invalid service address and can't connect.",

  'startup.loading': 'Starting Wayvro…',
  'startup.storageError': "Wayvro couldn't open its secure storage on this phone. Try again. If it keeps happening, reinstall the app.",

  'language.label': 'Language',
  'language.en': 'English',
  'language.ur': 'اردو',
  'language.urLatn': 'Roman Urdu',

  'phone.title': 'Sign in or create an account',
  'phone.body': "Enter your Pakistani mobile number. We'll send a 6-digit code by SMS.",
  'phone.label': 'Mobile number',
  'phone.hint': 'Format: 03XX XXXXXXX or +92 3XX XXXXXXX',
  'phone.invalid': 'Enter a Pakistani mobile number, for example 03XX XXXXXXX.',
  'phone.submit': 'Send code',
  'phone.sending': 'Sending code…',
  'phone.otpUnavailable': "We can't send sign-in codes right now. Please try again later.",
  'phone.legalNote': "After signing in you'll be asked to review Wayvro's Terms and Privacy Notice.",
  'phone.sessionEnded': 'Your session has ended. Please sign in again.',
  'phone.signedOut': "You've signed out.",
  'phone.signedOutLocalOnly': "You've signed out on this phone. We couldn't reach Wayvro to end the session on the server; it will expire on its own.",

  'otp.title': 'Enter your code',
  'otp.body': 'We sent a 6-digit code to {destination}.',
  'otp.label': '6-digit code',
  'otp.submit': 'Verify and continue',
  'otp.verifying': 'Checking your code…',
  'otp.invalidFormat': 'Enter all 6 digits.',
  'otp.invalidOrExpired': 'That code is incorrect or has expired. Check it, or request a new code.',
  'otp.locked': 'Too many incorrect attempts. Request a new code to continue.',
  'otp.expired': 'This code has expired. Request a new code.',
  'otp.resend': 'Send a new code',
  'otp.resendIn': 'You can request a new code in {seconds} s',
  'otp.resending': 'Sending a new code…',
  'otp.resent': 'A new code was sent. Earlier codes no longer work.',
  'otp.changeNumber': 'Change number',
  'otp.restart': 'This sign-in attempt has ended. Enter your number again.',

  'policies.title': "Review Wayvro's policies",
  'policies.body': 'To use Wayvro, please read and accept these policies.',
  'policies.read': 'Read the full text',
  'policies.whatChanged': 'What changed: {summary}',
  'policies.accept': 'Accept and continue',
  'policies.accepting': 'Saving your acceptance…',
  'policies.accepted': 'Accepted',
  'policies.partial': 'Some acceptances were saved, but not all. Try again to finish.',
  'policies.changed': 'A policy was updated while you were reviewing it. Please review the latest version.',
  'policies.syncing': 'The latest version of this policy is still loading.',
  'policies.empty': 'There is nothing to accept right now.',
  'policies.declineHint': "Wayvro can't be used without accepting these policies. If you don't want to accept, you can sign out.",
  'policies.driverTitle': 'Driver/Partner policies',
  'policies.driverBody': 'To apply as a Driver/Partner, please read and accept these policies. They cover how your application and documents are handled.',
  'policies.driverDeclineHint': "If you don't accept, your application can't continue. Booking rides as a rider is not affected.",

  'legal.title': 'Legal and policies',
  'legal.empty': 'No policies are available right now.',
  'legal.englishOnly': 'Shown in English: this text is not available in your language yet.',

  'age.title': 'Confirm your age',
  'age.affirmGeneric': "I confirm that I meet Wayvro's minimum age requirement.",
  'age.affirmWithAge': 'I confirm that I am at least {minimumAge} years old.',
  'age.affirmHelp': "Wayvro's age requirement comes from its age-eligibility policy. If you don't meet it, please don't use Wayvro.",
  'age.dobLabel': 'Date of birth',
  'age.dobHelp': 'Your date of birth is stored encrypted and used only to check age eligibility.',
  'age.day': 'Day (DD)',
  'age.month': 'Month (MM)',
  'age.year': 'Year (YYYY)',
  'age.dobInvalid': 'Enter a valid date of birth.',
  'age.mustAffirm': 'Tick the box to confirm.',
  'age.submit': 'Confirm',
  'age.notRequired': 'No age declaration is needed right now.',
  'age.changed': 'The age policy was updated. Please review it again.',

  'required.title': 'One more step is needed',
  'required.phoneStepUp':
    "Wayvro needs to re-confirm your phone number. This step isn't available in this version of the app yet. Please sign out and try again later.",
  'required.recoveryReview':
    "This account needs a recovery review before it can be used on this phone. This step isn't available in this version of the app yet.",

  'home.title': 'Your account',
  'home.greeting': 'Hello, {name}',
  'home.greetingNoName': 'Hello',
  'home.memberSince': 'Member since {date}',
  'home.ridesComing': "Booking rides isn't available in this version yet.",
  'home.earn': 'Earn with Wayvro',
  'home.earnHint': 'Apply to drive with Wayvro in this same app',
  'home.driverArea': 'Driver/Partner',
  'home.driverAreaHint': 'Your application, documents and renewals',
  'home.signOutConfirmTitle': 'Sign out?',
  'home.signOutConfirmBody': "You'll need a new SMS code to sign in again.",

  'restriction.title': 'Account restriction',
  'restriction.class.SAFETY': 'Your account is restricted for safety reasons.',
  'restriction.class.FRAUD': 'Your account is restricted because of suspected misuse.',
  'restriction.class.LEGAL': 'Your account is restricted for legal reasons.',
  'restriction.class.COMPLIANCE': "Your account is restricted because a compliance requirement isn't met.",
  'restriction.class.QUALITY': 'Your account is restricted because of service-quality concerns.',
  'restriction.class.SECURITY_HOLD': 'Your account is on a temporary security hold.',
  'restriction.class.RISK_HOLD': 'Your account is on a temporary hold while recent activity is reviewed.',
  'restriction.class.AGE_POLICY': "Your account is restricted under Wayvro's age-eligibility policy.",
  'restriction.until': 'Until {date}',
  'restriction.indefinite': 'Until further notice',
  'restriction.reference': 'Reference: {code}',
  'restriction.appealable': "This decision can be appealed. Appeals can't be submitted in this version of the app yet.",

  'profile.title': 'Profile',
  'profile.nameLabel': 'Display name',
  'profile.nameHelp': 'How Wayvro addresses you. Up to 60 characters. Leave empty to remove it.',
  'profile.nameInvalid': 'Use up to 60 characters, without control or direction-override characters.',
  'profile.localeLabel': 'Preferred language',
  'profile.save': 'Save changes',
  'profile.saved': 'Your changes were saved.',
  'profile.noChanges': 'There are no changes to save.',

  'sessions.title': 'Signed-in devices',
  'sessions.current': 'This phone',
  'sessions.android': 'Android device',
  'sessions.ios': 'iPhone',
  'sessions.lastUsed': 'Last active {date}',
  'sessions.signedIn': 'Signed in {date}',
  'sessions.appVersion': 'App version {version}',
  'sessions.revoke': 'Sign out this device',
  'sessions.revokeConfirmTitle': 'Sign out this device?',
  'sessions.revokeConfirmBody': 'That device will need a new SMS code to sign in again.',
  'sessions.revokeOthers': 'Sign out all other devices',
  'sessions.revokeOthersConfirmTitle': 'Sign out all other devices?',
  'sessions.revokeOthersConfirmBody': 'Every device except this phone will be signed out.',
  'sessions.revokedOthers': 'Other devices signed out: {count}',
  'sessions.revoked': 'The device was signed out.',
  'sessions.onlyThisPhone': 'No other devices are signed in.',

  'security.title': 'Security activity',
  'security.empty': 'No security activity yet.',
  'security.hint': "If you don't recognise an activity, sign out all other devices.",
  'security.event.SIGN_IN': 'Signed in',
  'security.event.SIGN_IN_NEW_DEVICE': 'Signed in on a new device',
  'security.event.DORMANT_ACCOUNT_NEW_INSTALLATION': 'Signed in on a new installation after a long period of inactivity',
  'security.event.SIGNED_OUT': 'Signed out',
  'security.event.SESSION_REVOKED': 'A device was signed out',
  'security.event.SESSIONS_REVOKED_ALL': 'All devices were signed out',
  'security.event.SESSIONS_REVOKED_OTHERS': 'All other devices were signed out',
  'security.event.REFRESH_TOKEN_REUSE_DETECTED': 'A session was ended after unusual activity',
  'security.event.PROFILE_UPDATED': 'Profile updated',
} as const;

export type StringKey = keyof typeof en;
type Catalogue = Readonly<Record<StringKey, string>>;

const ur: Catalogue = {
  appName: 'وے ورو',

  'common.retry': 'دوبارہ کوشش کریں',
  'common.continue': 'جاری رکھیں',
  'common.cancel': 'منسوخ کریں',
  'common.notNow': 'ابھی نہیں',
  'common.loading': 'لوڈ ہو رہا ہے…',
  'common.saving': 'محفوظ کیا جا رہا ہے…',
  'common.signOut': 'سائن آؤٹ کریں',
  'common.signingOut': 'سائن آؤٹ ہو رہا ہے…',
  'common.placeholderNotice': 'عارضی متن — پروڈکشن کے لیے نہیں — قانونی منظوری زیرِ التوا',
  'common.version': 'ورژن {version}',
  'common.effectiveFrom': '{date} سے نافذ',
  'common.staleData': 'آخری بار لوڈ کی گئی معلومات دکھائی جا رہی ہیں۔ انہیں تازہ نہیں کیا جا سکا۔',
  'common.translationPending': 'یہ ترجمہ ابھی اہلِ زبان کے جائزے کا منتظر ہے۔',

  'error.offline': 'وے ورو سے رابطہ نہیں ہو سکا۔ اپنا انٹرنیٹ کنکشن چیک کریں اور دوبارہ کوشش کریں۔',
  'error.rateLimited': 'بہت زیادہ کوششیں ہو گئیں۔ {seconds} سیکنڈ بعد دوبارہ کوشش کریں۔',
  'error.rateLimitedNoTime': 'بہت زیادہ کوششیں ہو گئیں۔ تھوڑی دیر انتظار کر کے دوبارہ کوشش کریں۔',
  'error.sessionExpired': 'آپ کا سیشن ختم ہو گیا ہے۔ آپ کی حفاظت کے لیے براہِ کرم دوبارہ سائن اِن کریں۔',
  'error.validation': 'براہِ کرم درج کی گئی معلومات چیک کریں اور دوبارہ کوشش کریں۔',
  'error.conflict': 'اس دوران یہ تبدیل ہو گیا۔ ہم نے اسے تازہ کر دیا ہے — براہِ کرم دیکھ کر دوبارہ کوشش کریں۔',
  'error.stepUp':
    'آپ کے اکاؤنٹ کی حفاظت کے لیے اس کام کو حالیہ سائن اِن درکار ہے۔ سائن آؤٹ کریں، اسی فون پر دوبارہ سائن اِن کریں، پھر دوبارہ کوشش کریں۔ تصدیق کا آسان طریقہ اگلے ورژن میں آئے گا۔',
  'error.unavailable': 'وے ورو عارضی طور پر دستیاب نہیں۔ براہِ کرم کچھ دیر بعد کوشش کریں۔',
  'error.unknown': 'کچھ غلط ہو گیا۔ براہِ کرم دوبارہ کوشش کریں۔',
  'error.requiredAction': 'براہِ کرم پہلے اپنے اکاؤنٹ کا مطلوبہ مرحلہ مکمل کریں۔',
  'error.restricted': 'ایک پابندی کی وجہ سے آپ کا اکاؤنٹ ابھی یہ کام نہیں کر سکتا۔ تفصیل آپ کے اکاؤنٹ کے صفحے پر ہے۔',
  'error.featureDisabled': 'یہ سہولت ابھی دستیاب نہیں۔',

  'config.title': 'سروس ترتیب نہیں دی گئی',
  'config.unconfigured': 'وے ورو کا یہ بلڈ کسی وے ورو سروس سے منسلک نہیں، اس لیے سائن اِن ممکن نہیں۔',
  'config.invalid': 'اس بلڈ میں سروس کا پتہ درست نہیں، اس لیے رابطہ نہیں ہو سکتا۔',

  'startup.loading': 'وے ورو شروع ہو رہا ہے…',
  'startup.storageError': 'وے ورو اس فون پر اپنی محفوظ اسٹوریج نہیں کھول سکا۔ دوبارہ کوشش کریں۔ اگر یہ مسئلہ برقرار رہے تو ایپ دوبارہ انسٹال کریں۔',

  'language.label': 'زبان',
  'language.en': 'English',
  'language.ur': 'اردو',
  'language.urLatn': 'رومن اردو',

  'phone.title': 'سائن اِن کریں یا نیا اکاؤنٹ بنائیں',
  'phone.body': 'اپنا پاکستانی موبائل نمبر درج کریں۔ ہم ایس ایم ایس کے ذریعے 6 ہندسوں کا کوڈ بھیجیں گے۔',
  'phone.label': 'موبائل نمبر',
  'phone.hint': 'طریقہ: 03XX XXXXXXX یا +92 3XX XXXXXXX',
  'phone.invalid': 'پاکستانی موبائل نمبر درج کریں، مثلاً 03XX XXXXXXX۔',
  'phone.submit': 'کوڈ بھیجیں',
  'phone.sending': 'کوڈ بھیجا جا رہا ہے…',
  'phone.otpUnavailable': 'ہم اس وقت سائن اِن کوڈ نہیں بھیج سکتے۔ براہِ کرم بعد میں کوشش کریں۔',
  'phone.legalNote': 'سائن اِن کے بعد آپ سے وے ورو کی شرائط اور پرائیویسی نوٹس دیکھنے کو کہا جائے گا۔',
  'phone.sessionEnded': 'آپ کا سیشن ختم ہو گیا ہے۔ براہِ کرم دوبارہ سائن اِن کریں۔',
  'phone.signedOut': 'آپ سائن آؤٹ ہو گئے ہیں۔',
  'phone.signedOutLocalOnly': 'آپ اس فون پر سائن آؤٹ ہو گئے ہیں۔ سرور پر سیشن ختم کرنے کے لیے وے ورو سے رابطہ نہیں ہو سکا؛ وہ خود ہی ختم ہو جائے گا۔',

  'otp.title': 'اپنا کوڈ درج کریں',
  'otp.body': 'ہم نے {destination} پر 6 ہندسوں کا کوڈ بھیجا ہے۔',
  'otp.label': '6 ہندسوں کا کوڈ',
  'otp.submit': 'تصدیق کریں اور جاری رکھیں',
  'otp.verifying': 'آپ کا کوڈ چیک کیا جا رہا ہے…',
  'otp.invalidFormat': 'تمام 6 ہندسے درج کریں۔',
  'otp.invalidOrExpired': 'یہ کوڈ غلط ہے یا اس کی مدت ختم ہو چکی ہے۔ اسے چیک کریں یا نیا کوڈ منگوائیں۔',
  'otp.locked': 'بہت زیادہ غلط کوششیں ہو گئیں۔ جاری رکھنے کے لیے نیا کوڈ منگوائیں۔',
  'otp.expired': 'اس کوڈ کی مدت ختم ہو چکی ہے۔ نیا کوڈ منگوائیں۔',
  'otp.resend': 'نیا کوڈ بھیجیں',
  'otp.resendIn': 'آپ {seconds} سیکنڈ بعد نیا کوڈ منگوا سکتے ہیں',
  'otp.resending': 'نیا کوڈ بھیجا جا رہا ہے…',
  'otp.resent': 'نیا کوڈ بھیج دیا گیا ہے۔ پرانے کوڈ اب کام نہیں کریں گے۔',
  'otp.changeNumber': 'نمبر تبدیل کریں',
  'otp.restart': 'سائن اِن کی یہ کوشش ختم ہو گئی ہے۔ اپنا نمبر دوبارہ درج کریں۔',

  'policies.title': 'وے ورو کی پالیسیاں دیکھیں',
  'policies.body': 'وے ورو استعمال کرنے کے لیے براہِ کرم یہ پالیسیاں پڑھیں اور قبول کریں۔',
  'policies.read': 'مکمل متن پڑھیں',
  'policies.whatChanged': 'کیا تبدیل ہوا: {summary}',
  'policies.accept': 'قبول کریں اور جاری رکھیں',
  'policies.accepting': 'آپ کی منظوری محفوظ کی جا رہی ہے…',
  'policies.accepted': 'قبول کر لی گئی',
  'policies.partial': 'کچھ منظوریاں محفوظ ہو گئیں، سب نہیں۔ مکمل کرنے کے لیے دوبارہ کوشش کریں۔',
  'policies.changed': 'آپ کے دیکھنے کے دوران ایک پالیسی تبدیل ہو گئی۔ براہِ کرم تازہ ترین ورژن دیکھیں۔',
  'policies.syncing': 'اس پالیسی کا تازہ ترین ورژن ابھی لوڈ ہو رہا ہے۔',
  'policies.empty': 'اس وقت قبول کرنے کے لیے کچھ نہیں۔',
  'policies.declineHint': 'ان پالیسیوں کو قبول کیے بغیر وے ورو استعمال نہیں ہو سکتا۔ اگر آپ قبول نہیں کرنا چاہتے تو سائن آؤٹ کر سکتے ہیں۔',
  'policies.driverTitle': 'ڈرائیور/پارٹنر پالیسیاں',
  'policies.driverBody':
    'ڈرائیور/پارٹنر کے طور پر درخواست دینے کے لیے یہ پالیسیاں پڑھ کر قبول کریں۔ ان میں بتایا گیا ہے کہ آپ کی درخواست اور دستاویزات کو کیسے سنبھالا جاتا ہے۔',
  'policies.driverDeclineHint': 'اگر آپ قبول نہیں کرتے تو آپ کی درخواست آگے نہیں بڑھ سکتی۔ بطور سوار سواری بک کرنے پر کوئی اثر نہیں پڑتا۔',

  'legal.title': 'قانونی معلومات اور پالیسیاں',
  'legal.empty': 'اس وقت کوئی پالیسی دستیاب نہیں۔',
  'legal.englishOnly': 'انگریزی میں دکھایا جا رہا ہے: یہ متن ابھی آپ کی زبان میں دستیاب نہیں۔',

  'age.title': 'اپنی عمر کی تصدیق کریں',
  'age.affirmGeneric': 'میں تصدیق کرتا/کرتی ہوں کہ میں وے ورو کی کم از کم عمر کی شرط پوری کرتا/کرتی ہوں۔',
  'age.affirmWithAge': 'میں تصدیق کرتا/کرتی ہوں کہ میری عمر کم از کم {minimumAge} سال ہے۔',
  'age.affirmHelp': 'وے ورو کی عمر کی شرط اس کی اہلیتِ عمر پالیسی سے طے ہوتی ہے۔ اگر آپ یہ شرط پوری نہیں کرتے تو براہِ کرم وے ورو استعمال نہ کریں۔',
  'age.dobLabel': 'تاریخِ پیدائش',
  'age.dobHelp': 'آپ کی تاریخِ پیدائش انکرپٹ کر کے محفوظ کی جاتی ہے اور صرف عمر کی اہلیت جانچنے کے لیے استعمال ہوتی ہے۔',
  'age.day': 'دن (DD)',
  'age.month': 'مہینہ (MM)',
  'age.year': 'سال (YYYY)',
  'age.dobInvalid': 'درست تاریخِ پیدائش درج کریں۔',
  'age.mustAffirm': 'تصدیق کے لیے خانے پر نشان لگائیں۔',
  'age.submit': 'تصدیق کریں',
  'age.notRequired': 'اس وقت عمر کی تصدیق درکار نہیں۔',
  'age.changed': 'عمر کی پالیسی تبدیل ہو گئی ہے۔ براہِ کرم اسے دوبارہ دیکھیں۔',

  'required.title': 'ایک اور مرحلہ باقی ہے',
  'required.phoneStepUp':
    'وے ورو کو آپ کے فون نمبر کی دوبارہ تصدیق درکار ہے۔ یہ مرحلہ ابھی ایپ کے اس ورژن میں دستیاب نہیں۔ براہِ کرم سائن آؤٹ کریں اور بعد میں دوبارہ کوشش کریں۔',
  'required.recoveryReview': 'اس فون پر استعمال سے پہلے اس اکاؤنٹ کا ریکوری جائزہ ضروری ہے۔ یہ مرحلہ ابھی ایپ کے اس ورژن میں دستیاب نہیں۔',

  'home.title': 'آپ کا اکاؤنٹ',
  'home.greeting': 'السلام علیکم، {name}',
  'home.greetingNoName': 'السلام علیکم',
  'home.memberSince': '{date} سے رکن',
  'home.ridesComing': 'سواری بک کرنے کی سہولت ابھی اس ورژن میں دستیاب نہیں۔',
  'home.earn': 'وے ورو کے ساتھ کمائیں',
  'home.earnHint': 'اسی ایپ میں وے ورو کے ساتھ ڈرائیو کرنے کی درخواست دیں',
  'home.driverArea': 'ڈرائیور/پارٹنر',
  'home.driverAreaHint': 'آپ کی درخواست، دستاویزات اور تجدید',
  'home.signOutConfirmTitle': 'سائن آؤٹ کریں؟',
  'home.signOutConfirmBody': 'دوبارہ سائن اِن کے لیے آپ کو نیا ایس ایم ایس کوڈ درکار ہوگا۔',

  'restriction.title': 'اکاؤنٹ پر پابندی',
  'restriction.class.SAFETY': 'حفاظتی وجوہات کی بنا پر آپ کے اکاؤنٹ پر پابندی ہے۔',
  'restriction.class.FRAUD': 'غلط استعمال کے شبہ کی وجہ سے آپ کے اکاؤنٹ پر پابندی ہے۔',
  'restriction.class.LEGAL': 'قانونی وجوہات کی بنا پر آپ کے اکاؤنٹ پر پابندی ہے۔',
  'restriction.class.COMPLIANCE': 'ایک ضابطے کی شرط پوری نہ ہونے کی وجہ سے آپ کے اکاؤنٹ پر پابندی ہے۔',
  'restriction.class.QUALITY': 'سروس کے معیار سے متعلق خدشات کی وجہ سے آپ کے اکاؤنٹ پر پابندی ہے۔',
  'restriction.class.SECURITY_HOLD': 'آپ کا اکاؤنٹ عارضی طور پر سیکیورٹی کی وجہ سے روکا گیا ہے۔',
  'restriction.class.RISK_HOLD': 'حالیہ سرگرمی کے جائزے تک آپ کا اکاؤنٹ عارضی طور پر روکا گیا ہے۔',
  'restriction.class.AGE_POLICY': 'وے ورو کی اہلیتِ عمر پالیسی کے تحت آپ کے اکاؤنٹ پر پابندی ہے۔',
  'restriction.until': '{date} تک',
  'restriction.indefinite': 'تاحکمِ ثانی',
  'restriction.reference': 'حوالہ: {code}',
  'restriction.appealable': 'اس فیصلے کے خلاف اپیل کی جا سکتی ہے۔ ایپ کے اس ورژن میں ابھی اپیل جمع نہیں کی جا سکتی۔',

  'profile.title': 'پروفائل',
  'profile.nameLabel': 'ظاہری نام',
  'profile.nameHelp': 'وے ورو آپ کو اسی نام سے مخاطب کرے گا۔ زیادہ سے زیادہ 60 حروف۔ ہٹانے کے لیے خالی چھوڑ دیں۔',
  'profile.nameInvalid': 'زیادہ سے زیادہ 60 حروف استعمال کریں، کنٹرول یا سمت بدلنے والے حروف کے بغیر۔',
  'profile.localeLabel': 'پسندیدہ زبان',
  'profile.save': 'تبدیلیاں محفوظ کریں',
  'profile.saved': 'آپ کی تبدیلیاں محفوظ ہو گئیں۔',
  'profile.noChanges': 'محفوظ کرنے کے لیے کوئی تبدیلی نہیں۔',

  'sessions.title': 'سائن اِن شدہ ڈیوائسز',
  'sessions.current': 'یہ فون',
  'sessions.android': 'اینڈرائیڈ ڈیوائس',
  'sessions.ios': 'آئی فون',
  'sessions.lastUsed': 'آخری بار فعال: {date}',
  'sessions.signedIn': 'سائن اِن: {date}',
  'sessions.appVersion': 'ایپ ورژن {version}',
  'sessions.revoke': 'اس ڈیوائس کو سائن آؤٹ کریں',
  'sessions.revokeConfirmTitle': 'یہ ڈیوائس سائن آؤٹ کریں؟',
  'sessions.revokeConfirmBody': 'اس ڈیوائس کو دوبارہ سائن اِن کے لیے نیا ایس ایم ایس کوڈ درکار ہوگا۔',
  'sessions.revokeOthers': 'باقی تمام ڈیوائسز سائن آؤٹ کریں',
  'sessions.revokeOthersConfirmTitle': 'باقی تمام ڈیوائسز سائن آؤٹ کریں؟',
  'sessions.revokeOthersConfirmBody': 'اس فون کے علاوہ ہر ڈیوائس سائن آؤٹ ہو جائے گی۔',
  'sessions.revokedOthers': 'سائن آؤٹ کی گئی دیگر ڈیوائسز: {count}',
  'sessions.revoked': 'ڈیوائس سائن آؤٹ کر دی گئی۔',
  'sessions.onlyThisPhone': 'کوئی اور ڈیوائس سائن اِن نہیں۔',

  'security.title': 'سیکیورٹی سرگرمی',
  'security.empty': 'ابھی کوئی سیکیورٹی سرگرمی نہیں۔',
  'security.hint': 'اگر آپ کسی سرگرمی کو نہیں پہچانتے تو باقی تمام ڈیوائسز سائن آؤٹ کر دیں۔',
  'security.event.SIGN_IN': 'سائن اِن کیا گیا',
  'security.event.SIGN_IN_NEW_DEVICE': 'نئی ڈیوائس پر سائن اِن کیا گیا',
  'security.event.DORMANT_ACCOUNT_NEW_INSTALLATION': 'طویل غیر فعالیت کے بعد نئی انسٹالیشن پر سائن اِن کیا گیا',
  'security.event.SIGNED_OUT': 'سائن آؤٹ کیا گیا',
  'security.event.SESSION_REVOKED': 'ایک ڈیوائس سائن آؤٹ کی گئی',
  'security.event.SESSIONS_REVOKED_ALL': 'تمام ڈیوائسز سائن آؤٹ کی گئیں',
  'security.event.SESSIONS_REVOKED_OTHERS': 'باقی تمام ڈیوائسز سائن آؤٹ کی گئیں',
  'security.event.REFRESH_TOKEN_REUSE_DETECTED': 'غیر معمولی سرگرمی کے بعد ایک سیشن ختم کر دیا گیا',
  'security.event.PROFILE_UPDATED': 'پروفائل اپ ڈیٹ کیا گیا',
};

const urLatn: Catalogue = {
  appName: 'Wayvro',

  'common.retry': 'Dobara koshish karein',
  'common.continue': 'Jari rakhein',
  'common.cancel': 'Mansookh karein',
  'common.notNow': 'Abhi nahin',
  'common.loading': 'Load ho raha hai…',
  'common.saving': 'Mehfooz kiya ja raha hai…',
  'common.signOut': 'Sign out karein',
  'common.signingOut': 'Sign out ho raha hai…',
  'common.placeholderNotice': 'Aarzi matn — production ke liye nahin — qanooni manzoori baqi',
  'common.version': 'Version {version}',
  'common.effectiveFrom': '{date} se nafiz',
  'common.staleData': 'Aakhri baar load ki gayi maloomat dikhayi ja rahi hain. Inhein taza nahin kiya ja saka.',
  'common.translationPending': 'Yeh tarjuma abhi ahl-e-zaban ke jaaize ka muntazir hai.',

  'error.offline': 'Wayvro se rabta nahin ho saka. Apna internet connection check karein aur dobara koshish karein.',
  'error.rateLimited': 'Bohat zyada koshishein ho gayin. {seconds} second baad dobara koshish karein.',
  'error.rateLimitedNoTime': 'Bohat zyada koshishein ho gayin. Thori der intezar kar ke dobara koshish karein.',
  'error.sessionExpired': 'Aap ka session khatam ho gaya hai. Aap ki hifazat ke liye baraah-e-karam dobara sign in karein.',
  'error.validation': 'Baraah-e-karam darj ki gayi maloomat check karein aur dobara koshish karein.',
  'error.conflict': 'Is dauran yeh tabdeel ho gaya. Hum ne ise taza kar diya hai — baraah-e-karam dekh kar dobara koshish karein.',
  'error.stepUp':
    'Aap ke account ki hifazat ke liye is kaam ko haaliya sign in darkaar hai. Sign out karein, isi phone par dobara sign in karein, phir dobara koshish karein. Tasdeeq ka aasaan tareeqa agle version mein aaye ga.',
  'error.unavailable': 'Wayvro aarzi taur par dastiyab nahin. Baraah-e-karam kuch der baad koshish karein.',
  'error.unknown': 'Kuch ghalat ho gaya. Baraah-e-karam dobara koshish karein.',
  'error.requiredAction': 'Baraah-e-karam pehle apne account ka matloob marhala mukammal karein.',
  'error.restricted': 'Aik pabandi ki wajah se aap ka account abhi yeh kaam nahin kar sakta. Tafseel aap ke account ke safhe par hai.',
  'error.featureDisabled': 'Yeh sahulat abhi dastiyab nahin.',

  'config.title': 'Service set nahin ki gayi',
  'config.unconfigured': 'Wayvro ka yeh build kisi Wayvro service se munsalik nahin, is liye sign in mumkin nahin.',
  'config.invalid': 'Is build mein service ka pata durust nahin, is liye rabta nahin ho sakta.',

  'startup.loading': 'Wayvro shuru ho raha hai…',
  'startup.storageError':
    'Wayvro is phone par apni mehfooz storage nahin khol saka. Dobara koshish karein. Agar yeh masla barqarar rahe to app dobara install karein.',

  'language.label': 'Zaban',
  'language.en': 'English',
  'language.ur': 'اردو',
  'language.urLatn': 'Roman Urdu',

  'phone.title': 'Sign in karein ya naya account banayein',
  'phone.body': 'Apna Pakistani mobile number darj karein. Hum SMS ke zariye 6 hindson ka code bhejein ge.',
  'phone.label': 'Mobile number',
  'phone.hint': 'Tareeqa: 03XX XXXXXXX ya +92 3XX XXXXXXX',
  'phone.invalid': 'Pakistani mobile number darj karein, maslan 03XX XXXXXXX.',
  'phone.submit': 'Code bhejein',
  'phone.sending': 'Code bheja ja raha hai…',
  'phone.otpUnavailable': 'Hum is waqt sign in code nahin bhej sakte. Baraah-e-karam baad mein koshish karein.',
  'phone.legalNote': 'Sign in ke baad aap se Wayvro ki sharaait aur privacy notice dekhne ko kaha jaye ga.',
  'phone.sessionEnded': 'Aap ka session khatam ho gaya hai. Baraah-e-karam dobara sign in karein.',
  'phone.signedOut': 'Aap sign out ho gaye hain.',
  'phone.signedOutLocalOnly':
    'Aap is phone par sign out ho gaye hain. Server par session khatam karne ke liye Wayvro se rabta nahin ho saka; woh khud hi khatam ho jaye ga.',

  'otp.title': 'Apna code darj karein',
  'otp.body': 'Hum ne {destination} par 6 hindson ka code bheja hai.',
  'otp.label': '6 hindson ka code',
  'otp.submit': 'Tasdeeq karein aur jari rakhein',
  'otp.verifying': 'Aap ka code check kiya ja raha hai…',
  'otp.invalidFormat': 'Tamam 6 hindse darj karein.',
  'otp.invalidOrExpired': 'Yeh code ghalat hai ya is ki muddat khatam ho chuki hai. Ise check karein ya naya code mangwayein.',
  'otp.locked': 'Bohat zyada ghalat koshishein ho gayin. Jari rakhne ke liye naya code mangwayein.',
  'otp.expired': 'Is code ki muddat khatam ho chuki hai. Naya code mangwayein.',
  'otp.resend': 'Naya code bhejein',
  'otp.resendIn': 'Aap {seconds} second baad naya code mangwa sakte hain',
  'otp.resending': 'Naya code bheja ja raha hai…',
  'otp.resent': 'Naya code bhej diya gaya hai. Purane code ab kaam nahin karein ge.',
  'otp.changeNumber': 'Number tabdeel karein',
  'otp.restart': 'Sign in ki yeh koshish khatam ho gayi hai. Apna number dobara darj karein.',

  'policies.title': 'Wayvro ki policies dekhein',
  'policies.body': 'Wayvro istemal karne ke liye baraah-e-karam yeh policies parhein aur qabool karein.',
  'policies.read': 'Mukammal matn parhein',
  'policies.whatChanged': 'Kya tabdeel hua: {summary}',
  'policies.accept': 'Qabool karein aur jari rakhein',
  'policies.accepting': 'Aap ki manzoori mehfooz ki ja rahi hai…',
  'policies.accepted': 'Qabool kar li gayi',
  'policies.partial': 'Kuch manzooriyan mehfooz ho gayin, sab nahin. Mukammal karne ke liye dobara koshish karein.',
  'policies.changed': 'Aap ke dekhne ke dauran aik policy tabdeel ho gayi. Baraah-e-karam taza tareen version dekhein.',
  'policies.syncing': 'Is policy ka taza tareen version abhi load ho raha hai.',
  'policies.empty': 'Is waqt qabool karne ke liye kuch nahin.',
  'policies.declineHint': 'In policies ko qabool kiye baghair Wayvro istemal nahin ho sakta. Agar aap qabool nahin karna chahte to sign out kar sakte hain.',
  'policies.driverTitle': 'Driver/Partner policies',
  'policies.driverBody':
    'Driver/Partner ke taur par darkhwast dene ke liye yeh policies parh kar qabool karein. In mein bataya gaya hai ke aap ki darkhwast aur dastavezaat ko kaise sambhala jata hai.',
  'policies.driverDeclineHint':
    'Agar aap qabool nahin karte to aap ki darkhwast aage nahin barh sakti. Bataur sawar sawari book karne par koi asar nahin parta.',

  'legal.title': 'Qanooni maloomat aur policies',
  'legal.empty': 'Is waqt koi policy dastiyab nahin.',
  'legal.englishOnly': 'English mein dikhaya ja raha hai: yeh matn abhi aap ki zaban mein dastiyab nahin.',

  'age.title': 'Apni umar ki tasdeeq karein',
  'age.affirmGeneric': 'Main tasdeeq karta/karti hoon ke main Wayvro ki kam az kam umar ki shart poori karta/karti hoon.',
  'age.affirmWithAge': 'Main tasdeeq karta/karti hoon ke meri umar kam az kam {minimumAge} saal hai.',
  'age.affirmHelp':
    'Wayvro ki umar ki shart is ki ahliyat-e-umar policy se tay hoti hai. Agar aap yeh shart poori nahin karte to baraah-e-karam Wayvro istemal na karein.',
  'age.dobLabel': 'Tareekh-e-paidaish',
  'age.dobHelp': 'Aap ki tareekh-e-paidaish encrypt kar ke mehfooz ki jati hai aur sirf umar ki ahliyat jaanchne ke liye istemal hoti hai.',
  'age.day': 'Din (DD)',
  'age.month': 'Mahina (MM)',
  'age.year': 'Saal (YYYY)',
  'age.dobInvalid': 'Durust tareekh-e-paidaish darj karein.',
  'age.mustAffirm': 'Tasdeeq ke liye khane par nishan lagayein.',
  'age.submit': 'Tasdeeq karein',
  'age.notRequired': 'Is waqt umar ki tasdeeq darkaar nahin.',
  'age.changed': 'Umar ki policy tabdeel ho gayi hai. Baraah-e-karam ise dobara dekhein.',

  'required.title': 'Aik aur marhala baqi hai',
  'required.phoneStepUp':
    'Wayvro ko aap ke phone number ki dobara tasdeeq darkaar hai. Yeh marhala abhi app ke is version mein dastiyab nahin. Baraah-e-karam sign out karein aur baad mein dobara koshish karein.',
  'required.recoveryReview': 'Is phone par istemal se pehle is account ka recovery jaaiza zaroori hai. Yeh marhala abhi app ke is version mein dastiyab nahin.',

  'home.title': 'Aap ka account',
  'home.greeting': 'Assalam-o-alaikum, {name}',
  'home.greetingNoName': 'Assalam-o-alaikum',
  'home.memberSince': '{date} se rukn',
  'home.ridesComing': 'Sawari book karne ki sahulat abhi is version mein dastiyab nahin.',
  'home.earn': 'Wayvro ke saath kamayein',
  'home.earnHint': 'Isi app mein Wayvro ke saath drive karne ki darkhwast dein',
  'home.driverArea': 'Driver/Partner',
  'home.driverAreaHint': 'Aap ki darkhwast, dastavezaat aur tajdeed',
  'home.signOutConfirmTitle': 'Sign out karein?',
  'home.signOutConfirmBody': 'Dobara sign in ke liye aap ko naya SMS code darkaar ho ga.',

  'restriction.title': 'Account par pabandi',
  'restriction.class.SAFETY': 'Hifazati wajoohat ki bina par aap ke account par pabandi hai.',
  'restriction.class.FRAUD': 'Ghalat istemal ke shubah ki wajah se aap ke account par pabandi hai.',
  'restriction.class.LEGAL': 'Qanooni wajoohat ki bina par aap ke account par pabandi hai.',
  'restriction.class.COMPLIANCE': 'Aik zaabte ki shart poori na hone ki wajah se aap ke account par pabandi hai.',
  'restriction.class.QUALITY': 'Service ke miyaar se mutaliq khadshat ki wajah se aap ke account par pabandi hai.',
  'restriction.class.SECURITY_HOLD': 'Aap ka account aarzi taur par security ki wajah se roka gaya hai.',
  'restriction.class.RISK_HOLD': 'Haaliya sargarmi ke jaaize tak aap ka account aarzi taur par roka gaya hai.',
  'restriction.class.AGE_POLICY': 'Wayvro ki ahliyat-e-umar policy ke tehat aap ke account par pabandi hai.',
  'restriction.until': '{date} tak',
  'restriction.indefinite': 'Ta-hukm-e-saani',
  'restriction.reference': 'Hawala: {code}',
  'restriction.appealable': 'Is faisle ke khilaf appeal ki ja sakti hai. App ke is version mein abhi appeal jama nahin ki ja sakti.',

  'profile.title': 'Profile',
  'profile.nameLabel': 'Zahiri naam',
  'profile.nameHelp': 'Wayvro aap ko isi naam se mukhatib kare ga. Zyada se zyada 60 huroof. Hatane ke liye khali chhor dein.',
  'profile.nameInvalid': 'Zyada se zyada 60 huroof istemal karein, control ya simt badalne wale huroof ke baghair.',
  'profile.localeLabel': 'Pasandeeda zaban',
  'profile.save': 'Tabdeeliyan mehfooz karein',
  'profile.saved': 'Aap ki tabdeeliyan mehfooz ho gayin.',
  'profile.noChanges': 'Mehfooz karne ke liye koi tabdeeli nahin.',

  'sessions.title': 'Sign in shuda devices',
  'sessions.current': 'Yeh phone',
  'sessions.android': 'Android device',
  'sessions.ios': 'iPhone',
  'sessions.lastUsed': 'Aakhri baar faal: {date}',
  'sessions.signedIn': 'Sign in: {date}',
  'sessions.appVersion': 'App version {version}',
  'sessions.revoke': 'Is device ko sign out karein',
  'sessions.revokeConfirmTitle': 'Yeh device sign out karein?',
  'sessions.revokeConfirmBody': 'Us device ko dobara sign in ke liye naya SMS code darkaar ho ga.',
  'sessions.revokeOthers': 'Baqi tamam devices sign out karein',
  'sessions.revokeOthersConfirmTitle': 'Baqi tamam devices sign out karein?',
  'sessions.revokeOthersConfirmBody': 'Is phone ke ilawa har device sign out ho jaye gi.',
  'sessions.revokedOthers': 'Sign out ki gayi deegar devices: {count}',
  'sessions.revoked': 'Device sign out kar di gayi.',
  'sessions.onlyThisPhone': 'Koi aur device sign in nahin.',

  'security.title': 'Security sargarmi',
  'security.empty': 'Abhi koi security sargarmi nahin.',
  'security.hint': 'Agar aap kisi sargarmi ko nahin pehchante to baqi tamam devices sign out kar dein.',
  'security.event.SIGN_IN': 'Sign in kiya gaya',
  'security.event.SIGN_IN_NEW_DEVICE': 'Nayi device par sign in kiya gaya',
  'security.event.DORMANT_ACCOUNT_NEW_INSTALLATION': 'Taweel ghair faaliyat ke baad nayi installation par sign in kiya gaya',
  'security.event.SIGNED_OUT': 'Sign out kiya gaya',
  'security.event.SESSION_REVOKED': 'Aik device sign out ki gayi',
  'security.event.SESSIONS_REVOKED_ALL': 'Tamam devices sign out ki gayin',
  'security.event.SESSIONS_REVOKED_OTHERS': 'Baqi tamam devices sign out ki gayin',
  'security.event.REFRESH_TOKEN_REUSE_DETECTED': 'Ghair mamooli sargarmi ke baad aik session khatam kar diya gaya',
  'security.event.PROFILE_UPDATED': 'Profile update kiya gaya',
};

/** @internal exported for the catalogue completeness tests; code uses t(). */
export const CATALOGUE: Readonly<Record<UiLocale, Catalogue>> = { en, ur, 'ur-Latn': urLatn };

/** Locales whose copy is a provisional translation pending native-speaker review. */
export const PENDING_REVIEW_LOCALES: ReadonlySet<UiLocale> = new Set<UiLocale>(['ur', 'ur-Latn']);

const RTL_LOCALES: ReadonlySet<UiLocale> = new Set<UiLocale>(['ur']);

export function isRtl(locale: UiLocale): boolean {
  return RTL_LOCALES.has(locale);
}

export type TranslationParams = Readonly<Record<string, string | number>>;

/** Looks up `key` and fills `{name}` placeholders. Unknown placeholders are left visible (tests forbid them). */
export function t(locale: UiLocale, key: StringKey, params?: TranslationParams): string {
  const template = CATALOGUE[locale][key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

/** Policy texts exist in `en` and `ur`; Roman-Urdu users read the English text (labelled as such). */
export function policyLocaleFor(locale: UiLocale): 'en' | 'ur' {
  return locale === 'ur' ? 'ur' : 'en';
}

/** BCP-47 tag for date formatting (Roman Urdu uses Latin script and digits). @internal exported for unit tests */
export function dateLocaleTag(locale: UiLocale): string {
  return locale === 'ur' ? 'ur-PK' : 'en-PK';
}

/** Formats a server timestamp for display; the server's value is shown, never a device-time recomputation. */
export function formatDateTime(iso: string, locale: UiLocale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(dateLocaleTag(locale), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

export function formatDate(iso: string, locale: UiLocale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(dateLocaleTag(locale), { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}
