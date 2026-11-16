import 'dart:math' as math;

import 'package:flutter/painting.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rfq_desk/design/tokens.g.dart';

double _lum(Color c) {
  double ch(double v) => v <= 0.03928 ? v / 12.92 : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

double contrast(Color a, Color b) {
  final la = _lum(a), lb = _lum(b);
  return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05);
}

void main() {
  for (final (name, k) in [('light', KColors.light), ('dark', KColors.dark)]) {
    group('WCAG contrast, $name', () {
      void pair(String what, Color fg, Color bg, double min) =>
          test('$what ≥ $min', () => expect(contrast(fg, bg), greaterThanOrEqualTo(min)));

      for (final (sn, s) in [
        ('bg', k.bg),
        ('surface', k.surface),
        ('raised', k.surfaceRaised),
        ('sunken', k.surfaceSunken),
      ]) {
        pair('ink on $sn', k.ink, s, 4.5);
        pair('ink-muted on $sn', k.inkMuted, s, 4.5);
      }
      pair('primary text on surface', k.primary, k.surface, 4.5);
      pair('on-primary on primary', k.onPrimary, k.primary, 4.5);
      pair('on-primary on pressed', k.onPrimary, k.primaryPressed, 4.5);
      pair('on-primary-soft on primary-soft', k.onPrimarySoft, k.primarySoft, 4.5);
      pair('on-accent on accent', k.onAccent, k.accent, 4.5);
      pair('danger text on surface', k.danger, k.surface, 4.5);
      pair('on-danger on danger', k.onDanger, k.danger, 4.5);
      pair('on-danger-soft', k.onDangerSoft, k.dangerSoft, 4.5);
      pair('on-success-soft', k.onSuccessSoft, k.successSoft, 4.5);
      pair('on-warning-soft', k.onWarningSoft, k.warningSoft, 4.5);
      pair('on-info-soft', k.onInfoSoft, k.infoSoft, 4.5);
      pair('success text on surface', k.success, k.surface, 4.5);
      pair('warning text on surface', k.warning, k.surface, 4.5);
      pair('on-brand-surface', k.onBrandSurface, k.brandSurface, 4.5);
      pair('on-brand-surface-muted', k.onBrandSurfaceMuted, k.brandSurface, 4.5);
      pair('control borders (line-strong) on surface', k.lineStrong, k.surface, 3);
      pair('focus ring on surface', k.focus, k.surface, 3);
    });
  }

  test('the 4-point grid', () {
    for (final v in [
      KSpace.s1,
      KSpace.s2,
      KSpace.s3,
      KSpace.s4,
      KSpace.s5,
      KSpace.s6,
      KSpace.s8,
      KSpace.s10,
      KSpace.s12,
      KSpace.s16,
    ]) {
      expect(v % 4, 0);
    }
    expect(KSize.touch, greaterThanOrEqualTo(48));
  });
}
