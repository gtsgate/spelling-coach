// Dialogs for proposing changes (SPEC §7.4). Work in progress — every export resolves to a boolean
// (true when ops were added to the draft).
import { toast } from '../dom.js';

const soon = async () => { toast('…'); return false; };
export const openEditPerson = soon;
export const openAddRelative = soon;
export const openAddRelativeSheet = soon;
export const openMarkAs = soon;
export const openReorderChildren = soon;
export const openReorderSpouses = soon;
export const openChangeParents = soon;
export const openLinkExisting = soon;
export const openMerge = soon;
export const openRequestRemoval = soon;
export const openMoreOptions = soon;
