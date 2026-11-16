import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

/// Motion: Kestrel › Motion. Every duration collapses to zero when the person has asked
/// the system to reduce motion, so no animation is ever forced on anyone.
class KMotion {
  const KMotion._(this._reduced);
  final bool _reduced;

  static KMotion of(BuildContext context) => KMotion._(MediaQuery.maybeDisableAnimationsOf(context) ?? false);

  bool get reduced => _reduced;

  /// Pressed states, toggles, checkbox ticks.
  Duration get instant => _d(100);

  /// Fades, chip selection, small expansions, toasts in.
  Duration get quick => _d(200);

  /// Sheets and dialogs entering, page push.
  Duration get standard => _d(300);

  /// Large layout changes and success moments (rare).
  Duration get slow => _d(400);

  Duration _d(int ms) => _reduced ? Duration.zero : Duration(milliseconds: ms);

  /// Most moves on screen.
  static const Curve standardCurve = Cubic(0.2, 0, 0, 1);

  /// Elements arriving.
  static const Curve enter = Cubic(0, 0, 0, 1);

  /// Elements leaving.
  static const Curve exit = Cubic(0.3, 0, 1, 1);

  /// The press: a short spring that settles without wobbling.
  static const Curve press = Curves.easeOutBack;
}

/// Haptics: Kestrel › Motion › haptics. One meaning per pattern, used sparingly, never the
/// only feedback (there is always a visual change too).
abstract final class KHaptics {
  /// Tests and the person's setting switch haptics off.
  static bool enabled = true;

  /// A tap on a control.
  static Future<void> tap() => _run(HapticFeedback.selectionClick);

  /// A switch, checkbox or segment changed.
  static Future<void> toggle() => _run(HapticFeedback.lightImpact);

  /// Something important went through: a payment sent, a quotation sent, a deal won.
  static Future<void> success() => _run(HapticFeedback.mediumImpact);

  /// About to do something that can't be undone (destructive confirm).
  static Future<void> warning() => _run(HapticFeedback.heavyImpact);

  /// It failed.
  static Future<void> error() => _run(HapticFeedback.vibrate);

  static Future<void> _run(Future<void> Function() f) => enabled ? f() : Future.value();
}

/// Words that greet people like a colleague would, by the time of day.
String greeting(DateTime now, String firstName) {
  final h = now.hour;
  final part = h < 5
      ? 'Working late'
      : h < 12
      ? 'Good morning'
      : h < 17
      ? 'Good afternoon'
      : 'Good evening';
  return '$part, $firstName';
}
