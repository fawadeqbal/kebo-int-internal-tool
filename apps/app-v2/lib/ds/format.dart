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
