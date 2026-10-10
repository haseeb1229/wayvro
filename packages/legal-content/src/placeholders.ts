/**
 * PLACEHOLDER policy texts (status PLACEHOLDER_NOT_FOR_PRODUCTION). They are structural outlines written WITHOUT legal
 * review: they name the topics the counsel-approved documents are expected to address and make no commitments.
 * Production refuses them (CL-P2-09); counsel-approved texts arrive through activation track P2.A7 (EG-02/EG-15) as
 * new versions. Urdu wording is pending native-speaker review.
 */
import type { PolicyBody, PolicyKey, PolicyLocale } from './types.js';

const BANNER: Readonly<Record<PolicyLocale, { heading: string; paragraphs: readonly string[] }>> = {
  en: {
    heading: 'PLACEHOLDER — NOT FOR PRODUCTION — pending counsel approval',
    paragraphs: [
      'This text is a structural outline written without legal review. It is not an agreement between Wayvro and you and creates no rights or obligations.',
      'A counsel-approved version will replace it before any real user is onboarded. Until then Wayvro operates with synthetic test data only.',
    ],
  },
  ur: {
    heading: 'عارضی متن — پروڈکشن کے لیے نہیں — قانونی مشیر کی منظوری زیرِ التوا',
    paragraphs: [
      'یہ متن قانونی جائزے کے بغیر لکھا گیا ایک خاکہ ہے۔ یہ ویورو اور آپ کے درمیان کوئی معاہدہ نہیں ہے اور اس سے کوئی حق یا ذمہ داری پیدا نہیں ہوتی۔',
      'کسی بھی حقیقی صارف کی شمولیت سے پہلے قانونی مشیر کا منظور شدہ متن اس کی جگہ لے گا۔ تب تک ویورو صرف مصنوعی آزمائشی ڈیٹا کے ساتھ کام کرتا ہے۔',
      '(اردو ترجمہ: مقامی زبان کے ماہر کا جائزہ زیرِ التوا)',
    ],
  },
};

const OUTLINE_HEADING: Readonly<Record<PolicyLocale, string>> = {
  en: 'Topics the approved document is expected to address',
  ur: 'وہ موضوعات جن کا منظور شدہ دستاویز میں احاطہ متوقع ہے',
};

interface Outline {
  readonly title: Readonly<Record<PolicyLocale, string>>;
  readonly topics: Readonly<Record<PolicyLocale, readonly string[]>>;
}

const OUTLINES: Readonly<Record<PolicyKey, Outline>> = {
  TERMS: {
    title: { en: 'Wayvro Passenger Terms', ur: 'ویورو مسافر شرائط' },
    topics: {
      en: [
        'Who may use Wayvro, subject to the age and eligibility policy.',
        'Your account, signing in with your mobile number, and keeping your account secure.',
        'Bookings, fares and payments, as those services are introduced.',
        'Cancellations and refunds (see the separate cancellation and refund policy).',
        'Safety, conduct and the Community Guidelines.',
        'Restrictions, suspensions, and how to appeal a decision.',
        'How these Terms change and how you are told about changes.',
        'How to contact Wayvro and make a complaint.',
      ],
      ur: [
        'عمر اور اہلیت کی پالیسی کے تحت ویورو کون استعمال کر سکتا ہے۔',
        'آپ کا اکاؤنٹ، موبائل نمبر سے سائن اِن، اور اکاؤنٹ کی حفاظت۔',
        'بکنگ، کرایہ اور ادائیگیاں، جب یہ سہولیات متعارف ہوں۔',
        'منسوخی اور رقم کی واپسی (علیحدہ منسوخی اور واپسی کی پالیسی دیکھیں)۔',
        'حفاظت، طرزِ عمل اور کمیونٹی رہنما اصول۔',
        'پابندیاں، معطلی، اور کسی فیصلے کے خلاف اپیل کا طریقہ۔',
        'ان شرائط میں تبدیلی اور آپ کو تبدیلیوں سے آگاہ کرنے کا طریقہ۔',
        'ویورو سے رابطہ اور شکایت درج کرنے کا طریقہ۔',
      ],
    },
  },
  PRIVACY: {
    title: { en: 'Wayvro Privacy Notice', ur: 'ویورو پرائیویسی نوٹس' },
    topics: {
      en: [
        'What data is collected (for example your mobile number, account details, app installation identifier and security activity) and why.',
        'What Wayvro does not collect or infer: gender is never inferred from your face, name, identity number or photo.',
        'How long each kind of data is kept (retention periods are pending counsel approval).',
        'Who can access your data, and how every staff access to identity evidence is logged.',
        'Where data is stored and which service providers process it (pending legal review).',
        'Your choices: access, correction and deletion requests, where the law allows.',
        'How you are told about security incidents that affect you.',
        'How to contact Wayvro about privacy.',
      ],
      ur: [
        'کون سا ڈیٹا جمع کیا جاتا ہے (مثلاً آپ کا موبائل نمبر، اکاؤنٹ کی تفصیلات، ایپ انسٹالیشن شناخت کنندہ اور سیکیورٹی سرگرمی) اور کیوں۔',
        'ویورو کیا جمع یا اخذ نہیں کرتا: آپ کے چہرے، نام، شناختی نمبر یا تصویر سے کبھی جنس اخذ نہیں کی جاتی۔',
        'ہر قسم کا ڈیٹا کتنی مدت تک رکھا جاتا ہے (مدتیں قانونی مشیر کی منظوری کی منتظر ہیں)۔',
        'آپ کے ڈیٹا تک کس کی رسائی ہے، اور شناختی ثبوت تک عملے کی ہر رسائی کیسے ریکارڈ ہوتی ہے۔',
        'ڈیٹا کہاں محفوظ ہوتا ہے اور کون سے سروس فراہم کنندگان اس پر کام کرتے ہیں (قانونی جائزہ زیرِ التوا)۔',
        'آپ کے اختیارات: جہاں قانون اجازت دے، رسائی، درستی اور حذف کی درخواست۔',
        'آپ کو متاثر کرنے والے سیکیورٹی واقعات کی اطلاع کیسے دی جاتی ہے۔',
        'پرائیویسی کے بارے میں ویورو سے رابطہ کیسے کریں۔',
      ],
    },
  },
  DRIVER_PARTNER_AGREEMENT: {
    title: { en: 'Wayvro Driver/Partner Agreement', ur: 'ویورو ڈرائیور/پارٹنر معاہدہ' },
    topics: {
      en: [
        'The relationship between Wayvro and Driver/Partners (pending counsel approval).',
        'Eligibility and verification: identity and documents are checked by a human reviewer; an in-person option exists.',
        'Required documents, their expiry and renewal.',
        'Conduct, safety and the Community Guidelines.',
        'Earnings and payouts, as those services are introduced (terms pending).',
        'Restrictions, suspensions and appeals. A Driver/Partner restriction does not by itself block lawful passenger use.',
        'How the agreement ends.',
      ],
      ur: [
        'ویورو اور ڈرائیور/پارٹنرز کے درمیان تعلق (قانونی مشیر کی منظوری زیرِ التوا)۔',
        'اہلیت اور تصدیق: شناخت اور دستاویزات کی جانچ ایک انسانی جائزہ کار کرتا ہے؛ ذاتی طور پر حاضری کا متبادل موجود ہے۔',
        'مطلوبہ دستاویزات، ان کی میعاد اور تجدید۔',
        'طرزِ عمل، حفاظت اور کمیونٹی رہنما اصول۔',
        'آمدنی اور ادائیگیاں، جب یہ سہولیات متعارف ہوں (شرائط زیرِ التوا)۔',
        'پابندیاں، معطلی اور اپیل۔ ڈرائیور/پارٹنر پر پابندی بذاتِ خود مسافر کے طور پر جائز استعمال نہیں روکتی۔',
        'معاہدہ کیسے ختم ہوتا ہے۔',
      ],
    },
  },
  BIOMETRIC_KYC_NOTICE: {
    title: { en: 'Identity Verification (KYC) and Selfie Notice', ur: 'شناختی تصدیق (KYC) اور سیلفی نوٹس' },
    topics: {
      en: [
        'Only Driver/Partner applicants are asked for identity evidence; passengers are not.',
        'What is collected: CNIC images, a selfie for manual review, driving licence and vehicle documents.',
        'Purpose: review by a trained human. Wayvro does not use automated face recognition or an automated liveness decision; a selfie upload is never treated as proof of liveness.',
        'Who can view the evidence: authorised reviewers only, with a stated reason; every view is logged.',
        'How the evidence is protected: encrypted storage; no public links.',
        'How long it is kept (pending counsel approval) and how deletion works.',
        'Alternatives: if a capture step is not possible for you, in-person verification is available.',
        'How to dispute a decision, correct information or appeal.',
      ],
      ur: [
        'شناختی ثبوت صرف ڈرائیور/پارٹنر درخواست دہندگان سے مانگا جاتا ہے؛ مسافروں سے نہیں۔',
        'کیا جمع کیا جاتا ہے: شناختی کارڈ کی تصاویر، دستی جائزے کے لیے ایک سیلفی، ڈرائیونگ لائسنس اور گاڑی کی دستاویزات۔',
        'مقصد: تربیت یافتہ انسان کا جائزہ۔ ویورو خودکار چہرہ شناسی یا خودکار زندہ پن (لائیونس) کا فیصلہ استعمال نہیں کرتا؛ سیلفی اپ لوڈ کو کبھی زندہ پن کا ثبوت نہیں سمجھا جاتا۔',
        'ثبوت کون دیکھ سکتا ہے: صرف مجاز جائزہ کار، بیان کردہ وجہ کے ساتھ؛ ہر بار دیکھنا ریکارڈ ہوتا ہے۔',
        'ثبوت کی حفاظت: خفیہ کاری کے ساتھ محفوظ؛ کوئی عوامی لنک نہیں۔',
        'یہ کتنی دیر رکھا جاتا ہے (قانونی مشیر کی منظوری زیرِ التوا) اور حذف کیسے ہوتا ہے۔',
        'متبادل: اگر کوئی کیپچر مرحلہ آپ کے لیے ممکن نہ ہو تو ذاتی طور پر تصدیق دستیاب ہے۔',
        'فیصلے پر اعتراض، معلومات کی درستی یا اپیل کیسے کریں۔',
      ],
    },
  },
  COMMUNITY_GUIDELINES: {
    title: { en: 'Wayvro Community Guidelines', ur: 'ویورو کمیونٹی رہنما اصول' },
    topics: {
      en: [
        'Respect and non-discrimination for passengers and Driver/Partners.',
        'Safety expectations for everyone on a trip.',
        'No harassment, threats or violence.',
        'Vehicle and conduct standards.',
        'How to report a problem.',
        'Consequences of breaking the guidelines, and how to appeal.',
      ],
      ur: [
        'مسافروں اور ڈرائیور/پارٹنرز کے لیے احترام اور عدم امتیاز۔',
        'سفر میں ہر ایک کے لیے حفاظتی توقعات۔',
        'ہراسانی، دھمکی یا تشدد کی کوئی گنجائش نہیں۔',
        'گاڑی اور طرزِ عمل کے معیارات۔',
        'کسی مسئلے کی اطلاع کیسے دیں۔',
        'رہنما اصولوں کی خلاف ورزی کے نتائج، اور اپیل کیسے کریں۔',
      ],
    },
  },
  CANCELLATION_REFUND: {
    title: { en: 'Cancellation and Refund Policy', ur: 'منسوخی اور رقم کی واپسی کی پالیسی' },
    topics: {
      en: [
        'When a cancellation fee may apply (to be defined together with pricing in a later phase).',
        'How to request a refund.',
        'How long a refund takes (pending).',
        'How disputes are handled.',
      ],
      ur: [
        'منسوخی کی فیس کب لاگو ہو سکتی ہے (بعد کے مرحلے میں کرایہ کے ساتھ طے ہو گا)۔',
        'رقم کی واپسی کی درخواست کیسے کریں۔',
        'رقم کی واپسی میں کتنا وقت لگتا ہے (زیرِ التوا)۔',
        'تنازعات کیسے نمٹائے جاتے ہیں۔',
      ],
    },
  },
  AGE_ELIGIBILITY: {
    title: { en: 'Age and Eligibility Policy', ur: 'عمر اور اہلیت کی پالیسی' },
    topics: {
      en: [
        'Wayvro will publish its counsel-approved minimum age and any guardian rules here. Until then no age threshold is set.',
        'Passengers are asked only for the minimum age declaration the approved policy requires; a date of birth is requested only if that policy requires it.',
        'Driver/Partner applicants have their date of birth checked by a human reviewer against their CNIC and driving licence.',
        'Age is never estimated from photos or other proxies.',
        'Teen or guardian programmes are not offered.',
        'How an age-related restriction is explained and appealed.',
      ],
      ur: [
        'ویورو قانونی مشیر کی منظور شدہ کم از کم عمر اور سرپرست سے متعلق قواعد یہاں شائع کرے گا۔ تب تک عمر کی کوئی حد مقرر نہیں ہے۔',
        'مسافروں سے صرف وہی کم از کم عمر کا اقرار مانگا جاتا ہے جو منظور شدہ پالیسی کو درکار ہو؛ تاریخِ پیدائش صرف اسی صورت میں پوچھی جاتی ہے جب پالیسی اس کی متقاضی ہو۔',
        'ڈرائیور/پارٹنر درخواست دہندگان کی تاریخِ پیدائش ایک انسانی جائزہ کار شناختی کارڈ اور ڈرائیونگ لائسنس سے جانچتا ہے۔',
        'تصاویر یا کسی اور ذریعے سے عمر کا کبھی اندازہ نہیں لگایا جاتا۔',
        'نو عمروں یا سرپرستوں کے پروگرام پیش نہیں کیے جاتے۔',
        'عمر سے متعلق پابندی کی وضاحت اور اپیل کیسے ہوتی ہے۔',
      ],
    },
  },
};

/** Placeholder body of a policy in a locale: banner + topic outline. */
export function placeholderBody(key: PolicyKey, locale: PolicyLocale): PolicyBody {
  const outline = OUTLINES[key];
  return {
    title: outline.title[locale],
    sections: [BANNER[locale], { heading: OUTLINE_HEADING[locale], paragraphs: outline.topics[locale] }],
  };
}

export const PLACEHOLDER_CHANGE_SUMMARY: Readonly<Record<PolicyLocale, string>> = {
  en: 'First placeholder outline (not counsel-approved; not for production).',
  ur: 'پہلا عارضی خاکہ (قانونی مشیر سے منظور شدہ نہیں؛ پروڈکشن کے لیے نہیں)۔',
};
