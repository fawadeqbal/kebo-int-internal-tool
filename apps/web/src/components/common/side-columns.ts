import { RULES } from "@kebo/ui";

/**
 * A page's work area beside its side panel: 380px from 1024, 340px beside the open menu on a laptop, 420px where
 * the page has room; under the page below that, in one column the screen's width (never wider: a long line in
 * a card would otherwise widen the page and a phone would zoom out). The numbers are in the rules file.
 */
export const SIDE_COLUMNS = RULES.page.withSheetPanel;
