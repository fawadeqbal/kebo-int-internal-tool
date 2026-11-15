import 'package:flutter/material.dart';

import '../feel.dart';
import '../theme.dart';

/// Kestrel › Skeleton: the shape of what is loading, with a calm shimmer.
/// Hidden from screen readers (announce "Loading …" once instead). Still under
/// reduced motion.
class KSkeleton extends StatefulWidget {
  const KSkeleton({super.key, this.width, this.height = 14, this.radius = KRadius.xs, this.circle = false});

  const KSkeleton.title({super.key, this.width = 180}) : height = 20, radius = KRadius.xs, circle = false;

  const KSkeleton.circle({super.key, double size = KSize.avatar})
    : width = size,
      height = size,
      radius = KRadius.full,
      circle = true;

  final double? width;
  final double height;
  final double radius;
  final bool circle;

  @override
  State<KSkeleton> createState() => _KSkeletonState();
}

class _KSkeletonState extends State<KSkeleton> with SingleTickerProviderStateMixin {
  late final AnimationController _shimmer = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (KMotion.of(context).reduced) {
      _shimmer.stop();
    } else if (!_shimmer.isAnimating) {
      _shimmer.repeat();
    }
  }

  @override
  void dispose() {
    _shimmer.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    return ExcludeSemantics(
      child: AnimatedBuilder(
        animation: _shimmer,
        builder: (context, _) {
          final t = _shimmer.value * 3 - 1;
          return Container(
            width: widget.width,
            height: widget.height,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(widget.radius),
              gradient: LinearGradient(
                begin: Alignment(t - 1, 0),
                end: Alignment(t + 1, 0),
                colors: [c.surfaceSunken, c.surface.withValues(alpha: 0.7), c.surfaceSunken],
              ),
            ),
          );
        },
      ),
    );
  }
}
