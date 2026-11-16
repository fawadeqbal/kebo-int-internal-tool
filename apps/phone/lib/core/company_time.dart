import 'package:timezone/data/latest_10y.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

/// The company's time (Company settings › Time and dates), from /api/auth/me: its time zone and how it writes
/// dates and times. Every date, time, "today" and "Good morning" on the phone goes through it, so the phone says
/// what the web says wherever the phone is. Until the company's zone is known: the phone's own.
class CompanyTime {
  CompanyTime._();

  static tz.Location? _zone;
  static bool _loaded = false;

  /// "d_mmm_yyyy" (14 Nov 2026), "dd_mm_yyyy" (14/11/2026), "mm_dd_yyyy" (11/14/2026) or "yyyy_mm_dd" (2026-11-14).
  static String dateFormat = 'd_mmm_yyyy';

  /// "24h" (15:30) or "12h" (3:30 PM).
  static String timeFormat = '24h';

  /// Set from the session; an unknown zone keeps the phone's own.
  static void set({String? zone, String? date, String? time}) {
    if (!_loaded) {
      tzdata.initializeTimeZones();
      _loaded = true;
    }
    try {
      _zone = zone == null || zone.isEmpty ? null : tz.getLocation(zone);
    } catch (_) {
      _zone = null;
    }
    dateFormat = date ?? 'd_mmm_yyyy';
    timeFormat = time ?? '24h';
  }

  /// Back to the phone's own time and the usual formats (signed out, tests).
  static void reset() {
    _zone = null;
    dateFormat = 'd_mmm_yyyy';
    timeFormat = '24h';
  }

  /// A moment as the company's clock shows it. A calendar day the API sent ("2026-11-14", read as midnight on
  /// the phone) is a day, the same everywhere: kept as it is.
  static DateTime of(DateTime d) {
    final zone = _zone;
    if (!d.isUtc && d.hour == 0 && d.minute == 0 && d.second == 0 && d.millisecond == 0 && d.microsecond == 0) return d;
    return zone == null ? d.toLocal() : tz.TZDateTime.from(d, zone);
  }

  /// Now, on the company's clock.
  static DateTime now() => _zone == null ? DateTime.now() : tz.TZDateTime.now(_zone!);

  /// The moment a day and time on the company's clock are (a time typed in a form).
  static DateTime moment(int year, int month, int day, [int hour = 0, int minute = 0]) =>
      _zone == null ? DateTime(year, month, day, hour, minute) : tz.TZDateTime(_zone!, year, month, day, hour, minute);

  /// Today on the company's clock, as a day ("2026-11-15" for the API).
  static DateTime today() {
    final n = now();
    return DateTime(n.year, n.month, n.day);
  }

  /// The date pattern: "dd MMM yyyy", "dd/MM/yyyy", "MM/dd/yyyy" or "yyyy-MM-dd".
  static String get dayPattern => switch (dateFormat) {
    'dd_mm_yyyy' => 'dd/MM/yyyy',
    'mm_dd_yyyy' => 'MM/dd/yyyy',
    'yyyy_mm_dd' => 'yyyy-MM-dd',
    _ => 'dd MMM yyyy',
  };

  /// A day without its year: "dd MMM", "dd/MM", "MM/dd" or "MM-dd".
  static String get dayMonthPattern => switch (dateFormat) {
    'dd_mm_yyyy' => 'dd/MM',
    'mm_dd_yyyy' => 'MM/dd',
    'yyyy_mm_dd' => 'MM-dd',
    _ => 'dd MMM',
  };

  /// The time pattern: "HH:mm" or "h:mm a".
  static String get timePattern => timeFormat == '12h' ? 'h:mm a' : 'HH:mm';
}
