/**
 * Documents' interface (architecture review §7.2): the only module that writes `order_papers` (the versions
 * of a made document) and `order_documents` (the order's document list). It asks nobody. What a document
 * says is built by its maker (the proforma and packing list in Orders, the other papers in Papers); how a
 * version lives (draft, final, made again) and how the list changes is decided here, once.
 */
export { deleteDraft, keepAsSent, makeAgain, makeFinal, saveDraft, startDraft, type VersionRow } from "./versions";
export { addDocument, changeDocument, fileRemoved, fileReplaced, paperReady, removeDocument } from "./list";
