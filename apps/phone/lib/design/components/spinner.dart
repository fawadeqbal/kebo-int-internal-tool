import 'package:flutter/material.dart';

import '../feel.dart';

/// A small circular spinner for busy buttons and compact areas. Under reduced
/// motion it is still shown (the busy state matters) but does not spin.
class KSpinner extends StatelessWidget {
  const KSpinner({super.key, required this.color, this.size = 20, this.stroke = 2});

  final Color color;
  final double size;
  final double stroke;

  @override
  Widget build(BuildContext context) {
    final reduced = KMotion.of(context).reduced;
    return SizedBox.square(
      dimension: size,
      child: CircularProgressIndicator(
        strokeWidth: stroke,
        color: color,
        value: reduced ? 0.75 : null,
        strokeCap: StrokeCap.round,
      ),
    );
  }
}
