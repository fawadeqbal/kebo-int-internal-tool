import '../../../design/design.dart';

/// The words and tones of a deal, the same as the web's.
abstract final class Stage {
  static const open = ['new', 'sourcing', 'quoted'];
  static const labels = {'new': 'New', 'sourcing': 'Getting prices', 'quoted': 'Quoted', 'won': 'Won', 'lost': 'Lost'};
  static const tones = {
    'new': KTone.neutral,
    'sourcing': KTone.warning,
    'quoted': KTone.info,
    'won': KTone.success,
    'lost': KTone.neutral,
  };
  static String label(String? s) => labels[s] ?? s ?? '';
  static KTone tone(String? s) => tones[s] ?? KTone.neutral;
  static KBadge badge(String? s) => KBadge(label(s), tone: tone(s));
  static bool isOpen(String? s) => open.contains(s);
}

abstract final class LostReason {
  static const labels = {
    'price_too_high': 'Our price was too high',
    'no_reply': 'No reply from the customer',
    'factory_cannot_supply': 'No factory can supply it',
    'bought_elsewhere': 'They bought elsewhere',
    'customer_cancelled': 'The customer cancelled',
    'duplicate_or_spam': 'Duplicate or spam',
    'other': 'Other',
  };
}

abstract final class Channel {
  static const labels = {
    'email': 'Email',
    'whatsapp': 'WhatsApp',
    'wechat': 'WeChat',
    'phone': 'Phone',
    'visit': 'Visit',
    'website': 'Website form',
    'other': 'Other',
  };
}

abstract final class Priority {
  static const labels = {'low': 'Low', 'normal': 'Normal', 'high': 'High', 'urgent': 'Urgent'};
}

abstract final class RevisionStatus {
  static const labels = {
    'draft': 'Draft',
    'sent': 'Sent',
    'accepted': 'Accepted',
    'rejected': 'Rejected',
    'expired': 'Expired',
    'superseded': 'Replaced',
  };
  static const tones = {
    'draft': KTone.neutral,
    'sent': KTone.info,
    'accepted': KTone.success,
    'rejected': KTone.danger,
    'expired': KTone.warning,
    'superseded': KTone.neutral,
  };
  static KBadge badge(String? s) => KBadge(labels[s] ?? s ?? '', tone: tones[s] ?? KTone.neutral);
}
