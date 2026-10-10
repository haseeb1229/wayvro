/** Locked SHA-256 of every published (key@version:locale) policy text (see catalogue.ts). Append only: editing a
 * published text in place fails the unit test and the API registry check; publish a new version instead. */
export const PUBLISHED_CONTENT_HASHES: Readonly<Record<string, string>> = {
  'TERMS@1:en': 'ee47b13f61271b8c7e9d706dba4e7b3d4f57928e3551dfae45bbaa7a3dc72027',
  'TERMS@1:ur': 'f38e738ed90cdd268304c517f778bd4b6864cb820648a039053f018a2ef0e72f',
  'PRIVACY@1:en': '1327f1de121f451f1b68434e222ffac2b069175397df1c75b2fd11594e1551a4',
  'PRIVACY@1:ur': '6c25fdc0729083b9d9a30bb36128a9eacaf8a219d260cd5019b86184fcfab5d8',
  'DRIVER_PARTNER_AGREEMENT@1:en': '02b087ed479536b4c1bdfb03bf8a9c40fc41b1ac236f97089c85340cd2c91729',
  'DRIVER_PARTNER_AGREEMENT@1:ur': '614da56f45cbe3286da35f3352fee8f87d5a83b170c1f409919eea1a291082db',
  'BIOMETRIC_KYC_NOTICE@1:en': '2b0ed049f8bcb78c233a0915334c4a2da9c9f930c33fab6b65a6f3ff39cdb45c',
  'BIOMETRIC_KYC_NOTICE@1:ur': '58b5acd46939d2597f1572c0cb0882ca742f276f85a30794053c2af5af0e5832',
  'COMMUNITY_GUIDELINES@1:en': '0b9ee4171dbb42104ab6d60861c02d21ed0488e6c9ec734fd7fdecbde15a427e',
  'COMMUNITY_GUIDELINES@1:ur': 'fced7981803c22b9d923a4aca440b7527f1eb71b8ea1037bfe1ac4f5f09ae812',
  'CANCELLATION_REFUND@1:en': 'a67d263ebbc38b4d8e4d34a907b1788df61ec025afca556691ffae92c2250db2',
  'CANCELLATION_REFUND@1:ur': 'f579d4c8b1824f74c5c7fb5ee291c644a4ee12c42400a760c165b54329f8ba33',
  'AGE_ELIGIBILITY@1:en': 'dfab170252e78f90df7678173beadbd716a616f68093a17a92036be6cd4ac4e4',
  'AGE_ELIGIBILITY@1:ur': '7d217e246dc5d479383d144733a494fd9449b56dff727a631470c1cec69288fd',
};
