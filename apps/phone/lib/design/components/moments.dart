import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../feel.dart';
import '../theme.dart';

/// Kestrel › Feel › moments. The few places the app lets itself show emotion: when
/// something the person worked for goes through. Used sparingly, so they mean something.

/// A check that draws itself inside a circle, with a success haptic. For "Payment sent
/// for verification", "Quotation sent", "Verified". Under reduced motion it appears drawn.
class SuccessCheck extends StatefulWidget {
  const SuccessCheck({
    super.key,
    this.size = 72,
    this.label = 'Done',
    this.hold = const Duration(milliseconds: 500),
    this.onDone,
  });

  final double size;
  final String label;

  /// How long the drawn check stays before [onDone] (time to see it).
  final Duration hold;

  /// Called once the check is drawn and has been seen: the screen moves on then.
  final VoidCallback? onDone;

  @override
  State<SuccessCheck> createState() => _SuccessCheckState();
}

class _SuccessCheckState extends State<SuccessCheck> with SingleTickerProviderStateMixin {
  // The draw (600 ms) and the hold after it, as one animation, so it runs on frames and
  // never on a loose timer.
  late final AnimationController _c =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 600) + widget.hold)
        ..addStatusListener((s) {
          if (s == AnimationStatus.completed) widget.onDone?.call();
        });
  late final Animation<double> _draw = CurvedAnimation(
    parent: _c,
    curve: Interval(0, 600 / (600 + widget.hold.inMilliseconds), curve: Curves.linear),
  );

  @override
  void initState() {
    super.initState();
    KHaptics.success();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (KMotion.of(context).reduced) {
      if (_c.value == 0) {
        _c.value = 1;
        WidgetsBinding.instance.addPostFrameCallback((_) => widget.onDone?.call());
      }
    } else if (_c.value == 0) {
      _c.forward();
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    return Semantics(
      label: widget.label,
      liveRegion: true,
      child: AnimatedBuilder(
        animation: _c,
        builder: (context, _) => CustomPaint(
          size: Size.square(widget.size),
          painter: _CheckPainter(
            progress: KMotion.standardCurve.transform(_draw.value),
            fill: k.successSoft,
            stroke: k.success,
          ),
        ),
      ),
    );
  }
}

class _CheckPainter extends CustomPainter {
  _CheckPainter({required this.progress, required this.fill, required this.stroke});

  final double progress;
  final Color fill;
  final Color stroke;

  @override
  void paint(Canvas canvas, Size size) {
    final r = size.width / 2;
    final center = Offset(r, r);
    final grow = (progress / 0.5).clamp(0.0, 1.0);
    canvas.drawCircle(center, r * (0.85 + 0.15 * grow), Paint()..color = fill.withValues(alpha: grow));
    final draw = ((progress - 0.35) / 0.65).clamp(0.0, 1.0);
    if (draw <= 0) return;
    final path = Path()
      ..moveTo(size.width * 0.30, size.height * 0.52)
      ..lineTo(size.width * 0.44, size.height * 0.66)
      ..lineTo(size.width * 0.71, size.height * 0.38);
    final metric = path.computeMetrics().first;
    canvas.drawPath(
      metric.extractPath(0, metric.length * draw),
      Paint()
        ..color = stroke
        ..style = PaintingStyle.stroke
        ..strokeWidth = size.width * 0.07
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round,
    );
  }

  @override
  bool shouldRepaint(_CheckPainter old) => old.progress != progress;
}

/// A short, quiet burst of brand and accent dots for the big wins only: a deal won,
/// an order closed after SAT. 700 ms, once. Nothing under reduced motion.
class Celebrate extends StatefulWidget {
  const Celebrate({super.key, required this.child, required this.play});

  final Widget child;

  /// Turning this true plays the burst once.
  final bool play;

  @override
  State<Celebrate> createState() => _CelebrateState();
}

class _CelebrateState extends State<Celebrate> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 700));

  @override
  void didUpdateWidget(Celebrate old) {
    super.didUpdateWidget(old);
    if (widget.play && !old.play && !KMotion.of(context).reduced) {
      KHaptics.success();
      _c.forward(from: 0);
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final k = context.k;
    return Stack(
      clipBehavior: Clip.none,
      alignment: Alignment.center,
      children: [
        widget.child,
        Positioned.fill(
          child: IgnorePointer(
            child: AnimatedBuilder(
              animation: _c,
              builder: (context, _) => _c.isAnimating
                  ? CustomPaint(painter: _BurstPainter(_c.value, [k.primary, k.accent, k.success]))
                  : const SizedBox.shrink(),
            ),
          ),
        ),
      ],
    );
  }
}

class _BurstPainter extends CustomPainter {
  _BurstPainter(this.t, this.colors);

  final double t;
  final List<Color> colors;

  @override
  void paint(Canvas canvas, Size size) {
    final center = size.center(Offset.zero);
    final ease = KMotion.enter.transform(t);
    const n = 14;
    for (var i = 0; i < n; i++) {
      final a = (i / n) * 2 * math.pi + (i.isEven ? 0.2 : -0.1);
      final dist = (40 + (i % 3) * 14) * ease;
      final p = center + Offset(math.cos(a), math.sin(a)) * dist;
      final paint = Paint()..color = colors[i % colors.length].withValues(alpha: (1 - t).clamp(0, 1));
      canvas.drawCircle(p, i % 3 == 0 ? 4 : 3, paint);
    }
  }

  @override
  bool shouldRepaint(_BurstPainter old) => old.t != t;
}
