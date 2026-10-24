import 'package:intl/intl.dart';

/// Same formats as the web (src/lib/utils/money.ts, dates.ts).
final _money = NumberFormat('#,##0.00', 'en_US');
final _qty = NumberFormat('#,##0.##', 'en_US');
final _date = DateFormat('dd MMM yyyy', 'en_US');
final _dateTime = DateFormat('dd MMM yyyy, HH:mm', 'en_US');
final _short = DateFormat('dd MMM', 'en_US');

int toCents(Object? v) {
  if (v == null) return 0;
  final n = v is num ? v : num.tryParse(v.toString().replaceAll(',', '')) ?? 0;
  return (n * 100).round();
}

String money(Object? value, String currency) => cents(toCents(value), currency);
String cents(int c, String currency) => '$currency ${_money.format(c / 100)}';
String amount(Object? value) => _money.format(toCents(value) / 100);
String qty(Object? value) => _qty.format(num.tryParse(value.toString()) ?? 0);

DateTime? parseDate(String? v) {
  if (v == null || v.isEmpty) return null;
  if (v.length == 10) return DateTime.tryParse('${v}T00:00:00');
  return DateTime.tryParse(v)?.toLocal();
}

String date(String? v) {
  final d = parseDate(v);
  return d == null ? '—' : _date.format(d);
}

String dateTime(String? v) {
  final d = parseDate(v);
  return d == null ? '—' : _dateTime.format(d);
}

String shortDate(String? v) {
  final d = parseDate(v);
  return d == null ? '—' : _short.format(d);
}

String isoDate(DateTime d) => DateFormat('yyyy-MM-dd').format(d);
String today() => isoDate(DateTime.now());

/// "3h 20m", "2d 4h" like the web.
String duration(num? ms) {
  if (ms == null || ms < 0) return '—';
  final minutes = (ms / 60000).floor();
  final days = minutes ~/ 1440;
  final hours = (minutes % 1440) ~/ 60;
  final mins = minutes % 60;
  if (days > 0) return '${days}d ${hours}h';
  if (hours > 0) return '${hours}h ${mins}m';
  return '${mins}m';
}

/// "5 min ago", "yesterday", or the date.
String ago(String? v) {
  final d = parseDate(v);
  if (d == null) return '—';
  final diff = DateTime.now().difference(d);
  if (diff.inMinutes < 1) return 'just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes} min ago';
  if (diff.inHours < 24) return '${diff.inHours} h ago';
  if (diff.inDays == 1) return 'yesterday';
  if (diff.inDays < 7) return '${diff.inDays} days ago';
  return _date.format(d);
}

String fileSize(num bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(0)} KB';
  return '${(bytes / 1024 / 1024).toStringAsFixed(1)} MB';
}

String kg(num v) => '${_money.format(v)} kg';
String cbm(num v) => '${NumberFormat('#,##0.000', 'en_US').format(v)} m³';

/// Line totals exactly as the server calculates them (cents, rounded per line).
({List<int> lines, int subtotal, int discount, int tax, int total}) lineTotals(List<({String quantity, String unitPrice})> items, String discount, String taxRate) {
  final lines = items.map((i) => ((num.tryParse(i.quantity) ?? 0) * toCents(i.unitPrice)).round()).toList();
  final subtotal = lines.fold<int>(0, (a, b) => a + b);
  final d = toCents(discount).clamp(0, subtotal);
  final taxable = subtotal - d;
  final rate = (num.tryParse(taxRate) ?? 0).clamp(0, 100);
  final tax = (taxable * rate / 100).round();
  return (lines: lines, subtotal: subtotal, discount: d, tax: tax, total: taxable + tax);
}

String customerName(Map<String, dynamic> c) {
  final company = (c['companyName'] ?? '').toString();
  final person = (c['contactPerson'] ?? '').toString();
  return company.isNotEmpty ? company : person;
}

String initials(String name) {
  final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
  if (parts.isEmpty) return '?';
  if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
  return (parts.first[0] + parts.last[0]).toUpperCase();
}
