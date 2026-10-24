import '../theme/colors.dart';

/// Business words and badge tones, the same as the web (src/lib/labels.ts).
const queryStatusLabel = {'pending': 'Pending', 'processing': 'Processing', 'completed': 'Completed', 'not_completed': 'Not Completed'};
const queryStatusTone = {'pending': Tone.warn, 'processing': Tone.info, 'completed': Tone.ok, 'not_completed': Tone.neutral};

const quotationStatusLabel = {'draft': 'Draft', 'sent': 'Sent', 'accepted': 'Accepted', 'rejected': 'Rejected', 'expired': 'Expired'};
const quotationStatusTone = {'draft': Tone.neutral, 'sent': Tone.info, 'accepted': Tone.ok, 'rejected': Tone.bad, 'expired': Tone.warn};

const invoiceStatusLabel = {'unpaid': 'Unpaid', 'partially_paid': 'Partially Paid', 'paid': 'Paid', 'cancelled': 'Cancelled', 'overdue': 'Overdue'};
const invoiceStatusTone = {'unpaid': Tone.warn, 'partially_paid': Tone.info, 'paid': Tone.ok, 'cancelled': Tone.neutral, 'overdue': Tone.bad};

const sourceLabel = {
  'website': 'Website form',
  'whatsapp': 'WhatsApp',
  'wechat': 'WeChat',
  'email': 'Email',
  'phone': 'Phone',
  'walk_in': 'Visit / trade fair',
  'other': 'Other',
};

const priorityLabel = {'low': 'Low', 'normal': 'Normal', 'high': 'High', 'urgent': 'Urgent'};
const priorityTone = {'low': Tone.outline, 'normal': Tone.neutral, 'high': Tone.warn, 'urgent': Tone.bad};

const paymentMethodLabel = {
  'bank_transfer': 'Bank transfer (T/T)',
  'lc': 'Letter of credit (L/C)',
  'cash': 'Cash',
  'cheque': 'Cheque',
  'online': 'Online payment',
  'other': 'Other',
};

const roleLabel = {'admin': 'Super Admin', 'manager': 'Manager', 'staff': 'Staff'};

/// Invoice status as shown (unpaid past its due date = overdue), like invoiceDisplayStatus().
String invoiceDisplayStatus(Map<String, dynamic> inv, String today) {
  final status = (inv['status'] ?? '').toString();
  final due = (inv['dueDate'] ?? '').toString();
  if ((status == 'unpaid' || status == 'partially_paid') && due.isNotEmpty && due.compareTo(today) < 0) return 'overdue';
  return status;
}
