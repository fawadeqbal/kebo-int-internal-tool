import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Kebo's details (the first company), as on its documents: what `pnpm db:seed`
 * gives the company "kebo" on a new database, so development and the tests
 * look like Kebo's real documents. The live Kebo keeps its own in its settings
 * (migration 20261113090000_company_brand); every other company fills in its own.
 */
export const KEBO_PROFILE = {
  name: "Shandong Kebo International Trade Co., Ltd.",
  nameLocal: "山东科波国际贸易有限公司",
  address: "No.5, Jielu Road, High-Tech Zone, City Jining, Shandong, China",
  phone: "+86-151-54754812  +86-178-53758700",
  email: "shandongkeboint@gmail.com",
  website: "www.keboint.com",
  taxNo: "91370811MAK4PH5B1N",
  bankDetails:
    "ACCOUNT NAME: SHANDONG KEBO INTERNATIONAL TRADE CO., LTD.\nBANK NAME: BANK OF CHINA RENCHENG SUB BRANCH\nBANK ADDRESS: B.O.C TOWER,1 TAIBAI ROAD JINING, SHANDONG, P, R. CHINA,\nPOST CODE: 272000\nSWIFT CODE: BKCHCNBJ500\nACCOUNT NO: 242895006310",
  proformaPrefix: "KEB",
  brandMark: "KEBO",
  brandTagline: "INTERNATIONAL TRADE",
  logo: `data:image/webp;base64,${readFileSync(join(__dirname, "kebo-logo.webp")).toString("base64")}`,
};
