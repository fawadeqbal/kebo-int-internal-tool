import 'package:intl/intl.dart';

import 'company_time.dart';

/// "28 Oct 2026" (or 28/10/2026…), the company's way and in its time zone.
String? fmtDate(DateTime? d) => d == null ? null : DateFormat(CompanyTime.dayPattern).format(CompanyTime.of(d));

/// "28 Oct" (or 28/10…): a day without its year, the company's way.
String? fmtDayMonth(DateTime? d) =>
    d == null ? null : DateFormat(CompanyTime.dayMonthPattern).format(CompanyTime.of(d));

/// "15:30" or "3:30 PM": a moment's time of day, company time.
String? fmtTime(DateTime? d) => d == null ? null : DateFormat(CompanyTime.timePattern).format(CompanyTime.of(d));

/// "28 Oct 2026, 15:30": a moment's day and time, company time and way.
String? fmtDateTime(DateTime? d) => d == null ? null : '${fmtDate(d)}, ${fmtTime(d)}';

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
String? fill(String template, String? value) =>
    value == null || value.isEmpty ? null : template.replaceAll('{}', value);

/// The parts that have a value, joined with " · ".
String joinParts(Iterable<String?> parts) => parts.whereType<String>().where((s) => s.trim().isNotEmpty).join(' · ');

/// When something happened, as people say it: "09:02", "yesterday", "Mon", "28 Oct" (company time and way).
String fmtWhen(DateTime? d, {DateTime? now}) {
  if (d == null) return '';
  final t = CompanyTime.of(d);
  final n = now ?? CompanyTime.now();
  final days = DateTime(n.year, n.month, n.day).difference(DateTime(t.year, t.month, t.day)).inDays;
  if (days == 0) return DateFormat(CompanyTime.timePattern).format(t);
  if (days == 1) return 'yesterday';
  if (days < 7) return DateFormat('EEE').format(t);
  return DateFormat(CompanyTime.dayMonthPattern).format(t);
}

/// The day heading of a list grouped by day: "Today", "Yesterday", "Mon 02 Nov".
String fmtDayHeading(DateTime d, {DateTime? now}) {
  final n = now ?? CompanyTime.now();
  final t = CompanyTime.of(d);
  final days = DateTime(n.year, n.month, n.day).difference(DateTime(t.year, t.month, t.day)).inDays;
  if (days == 0) return 'Today';
  if (days == 1) return 'Yesterday';
  return '${DateFormat('EEE').format(t)} ${DateFormat(CompanyTime.dayMonthPattern).format(t)}';
}

/// "USD 1.2M", "USD 44.1k": big amounts on cards.
String? fmtShort(String? amount, String? currency) {
  final n = amount == null ? null : num.tryParse(amount);
  if (n == null) return null;
  final a = n.abs();
  final text = a >= 1e6
      ? '${(n / 1e6).toStringAsFixed(1)}M'
      : a >= 1e4
      ? '${(n / 1e3).toStringAsFixed(1)}k'
      : NumberFormat('#,##0', 'en_US').format(n);
  return currency == null ? text : '$currency $text';
}

/// Words with a value, joined with spaces: "800 pcs"; null when none has one.
String? joinWords(Iterable<String?> parts) {
  final s = parts.whereType<String>().where((x) => x.trim().isNotEmpty).join(' ');
  return s.isEmpty ? null : s;
}

/// A typed time of day ("15:30", a follow-up's time), the company's way: "15:30" or "3:30 PM".
String? clockText(String? hhmm) {
  final m = hhmm == null ? null : RegExp(r'^(\d{1,2}):(\d{2})').firstMatch(hhmm);
  if (m == null) return hhmm;
  final h = int.parse(m[1]!);
  if (CompanyTime.timeFormat != '12h') return '${m[1]!.padLeft(2, '0')}:${m[2]}';
  return '${h % 12 == 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}';
}
