import 'package:intl/intl.dart';

final _day = DateFormat('d MMM yyyy');

/// "28 Oct 2026", in the phone's time zone.
String? fmtDate(DateTime? d) => d == null ? null : _day.format(d.toLocal());

/// "USD 12,400.00". [amount] is the API's decimal string.
String? fmtMoney(String? amount, String? currency) {
  if (amount == null || amount.isEmpty) return null;
  final n = num.tryParse(amount);
  final text = n == null ? amount : NumberFormat('#,##0.00', 'en_US').format(n);
  return currency == null || currency.isEmpty ? text : '$currency $text';
}

/// "1 open order" / "3 open orders"; null for 0 when [hideZero].
String? count(int n, String one, String many, {bool hideZero = false}) =>
    hideZero && n == 0 ? null : (n == 1 ? one : many).replaceAll('{}', '$n');

/// "{} days" with [value] in place of {}; null when there is no value.
String? fill(String template, String? value) => value == null || value.isEmpty ? null : template.replaceAll('{}', value);

/// The parts that have a value, joined with " · ".
String joinParts(Iterable<String?> parts) => parts.whereType<String>().where((s) => s.trim().isNotEmpty).join(' · ');

final _time = DateFormat('H:mm');
final _weekday = DateFormat('EEE');
final _dayMonth = DateFormat('d MMM');

/// When something happened, as people say it: "9:02", "yesterday", "Mon", "28 Oct".
String fmtWhen(DateTime? d, {DateTime? now}) {
  if (d == null) return '';
  final t = d.toLocal();
  final n = now ?? DateTime.now();
  final days = DateTime(n.year, n.month, n.day).difference(DateTime(t.year, t.month, t.day)).inDays;
  if (days == 0) return _time.format(t);
  if (days == 1) return 'yesterday';
  if (days < 7) return _weekday.format(t);
  return _dayMonth.format(t);
}

/// The day heading of a list grouped by day: "Today", "Yesterday", "Mon 2 Nov".
String fmtDayHeading(DateTime d, {DateTime? now}) {
  final n = now ?? DateTime.now();
  final t = d.toLocal();
  final days = DateTime(n.year, n.month, n.day).difference(DateTime(t.year, t.month, t.day)).inDays;
  if (days == 0) return 'Today';
  if (days == 1) return 'Yesterday';
  return DateFormat('EEE d MMM').format(t);
}

/// "USD 1.2M", "USD 44.1k": big amounts on cards.
String? fmtShort(String? amount, String? currency) {
  final n = amount == null ? null : num.tryParse(amount);
  if (n == null) return null;
  final a = n.abs();
  final text = a >= 1e6 ? '${(n / 1e6).toStringAsFixed(1)}M' : a >= 1e4 ? '${(n / 1e3).toStringAsFixed(1)}k' : NumberFormat('#,##0', 'en_US').format(n);
  return currency == null ? text : '$currency $text';
}

/// Words with a value, joined with spaces: "800 pcs"; null when none has one.
String? joinWords(Iterable<String?> parts) {
  final s = parts.whereType<String>().where((x) => x.trim().isNotEmpty).join(' ');
  return s.isEmpty ? null : s;
}
