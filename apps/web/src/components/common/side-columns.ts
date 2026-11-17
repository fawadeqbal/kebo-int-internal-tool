/**
 * A page's work area beside its side panel: 380px from 1024, 340px beside the open menu on a laptop, 420px where
 * the page has room; under the page below that, in one column the screen's width (never wider: a long line in
 * a card would otherwise widen the page and a phone would zoom out).
 */
export const SIDE_COLUMNS = "grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_340px] roomy:grid-cols-[minmax(0,1fr)_420px]";
