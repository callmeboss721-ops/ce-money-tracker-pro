// Default categories. IDs are stable so future seed updates can add new
// defaults without touching anything the user has edited.
// Core business categories are placed first for quick access.
export const DEFAULT_CATEGORIES = [
  // รายจ่าย (Expense)
  ['exp-ads', 'expense', 'โฆษณา', 'megaphone', '#4C8DFF'],
  ['exp-labor', 'expense', 'เงินเดือน/ทีมงาน', 'users', '#9B6BFF'],
  ['exp-tools', 'expense', 'เครื่องมือ/ซอฟต์แวร์', 'server', '#19B5FF'],
  ['exp-transfer-fee', 'expense', 'ค่าธรรมเนียมโอน', 'receipt', '#F59E0B'],
  ['exp-food', 'expense', 'อาหาร/เครื่องดื่ม', 'utensils', '#FF6B6B'],
  ['exp-travel', 'expense', 'เดินทาง/น้ำมัน', 'car', '#F5C542'],
  ['exp-utility', 'expense', 'ค่าน้ำ/ค่าไฟ/ค่าเน็ต', 'zap', '#FFD166'],
  ['exp-shopping', 'expense', 'ช้อปปิ้ง', 'shopping-basket', '#2A9D8F'],
  ['exp-platform-fee', 'expense', 'ค่าธรรมเนียมแพลตฟอร์ม/แลกเปลี่ยน', 'arrow-left-right', '#D4AF37'],
  ['exp-kyc', 'expense', 'ยืนยันตัวตน/เปิดบัญชี', 'shield-check', '#2ECC71'],
  ['exp-tax', 'expense', 'ภาษี/บัญชี/กฎหมาย', 'file-text', '#8E9AAF'],
  ['exp-health', 'expense', 'สุขภาพ', 'heart-pulse', '#FF5C8A'],
  ['exp-fun', 'expense', 'บันเทิง/สังสรรค์', 'party-popper', '#FF8A3D'],
  ['exp-goods', 'expense', 'ของใช้/พัสดุ', 'package', '#C98B4B'],
  ['exp-other', 'expense', 'อื่นๆ', 'ellipsis', '#7A8497'],
  // รายรับ (Income)
  ['inc-sales', 'income', 'ขายสินค้า/บริการ', 'store', '#19B5FF'],
  ['inc-fee', 'income', 'ค่าธรรมเนียม', 'percent', '#D4AF37'],
  ['inc-fx', 'income', 'กำไรส่วนต่างแลก', 'trending-up', '#2ECC71'],
  ['inc-commission', 'income', 'ค่านายหน้า/ค่าคอม', 'handshake', '#FF5C8A'],
  ['inc-project', 'income', 'โปรเจกต์/ค่าระบบ', 'laptop', '#9B6BFF'],
  ['inc-salary', 'income', 'เงินเดือน', 'briefcase', '#4C8DFF'],
  ['inc-interest', 'income', 'ดอกเบี้ย/ผลตอบแทน', 'piggy-bank', '#F5C542'],
  ['inc-refund', 'income', 'เงินคืน/Refund', 'rotate-ccw', '#8E9AAF'],
  ['inc-other', 'income', 'อื่นๆ', 'ellipsis', '#7A8497'],
].map(([id, type, name, icon, color], i) => ({
  id,
  type,
  name,
  icon,
  color,
  order: i,
  isDefault: true,
  deletedAt: null,
}));

// 16 colours for user-defined categories.
export const CATEGORY_COLORS = [
  '#FF6B6B', '#FF5C8A', '#FF8A3D', '#F59E0B', '#F5C542', '#FFD166', '#D4AF37', '#C98B4B',
  '#2ECC71', '#2A9D8F', '#19B5FF', '#4C8DFF', '#9B6BFF', '#E879F9', '#8E9AAF', '#7A8497',
];
