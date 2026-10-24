import 'package:flutter/material.dart';

/// The web app's design tokens (src/app/globals.css), light and dark.
/// Widgets use these semantic names, never raw colours.
@immutable
class AppColors extends ThemeExtension<AppColors> {
  const AppColors({
    required this.bg,
    required this.surface,
    required this.surface2,
    required this.surface3,
    required this.line,
    required this.lineStrong,
    required this.text,
    required this.text2,
    required this.muted,
    required this.primary,
    required this.primarySoft,
    required this.primarySolid,
    required this.trust,
    required this.trustSoft,
    required this.money,
    required this.moneySoft,
    required this.ok,
    required this.okSoft,
    required this.warn,
    required this.warnSoft,
    required this.bad,
    required this.badSoft,
    required this.info,
    required this.infoSoft,
    required this.charts,
  });

  final Color bg, surface, surface2, surface3, line, lineStrong, text, text2, muted;
  final Color primary, primarySoft, primarySolid;
  final Color trust, trustSoft, money, moneySoft, ok, okSoft, warn, warnSoft, bad, badSoft, info, infoSoft;
  final List<Color> charts;

  static const light = AppColors(
    bg: Color(0xFFF7F7F9),
    surface: Color(0xFFFFFFFF),
    surface2: Color(0xFFF2F2F5),
    surface3: Color(0xFFE9E9EE),
    line: Color(0xFFE4E4EA),
    lineStrong: Color(0xFFD3D3DC),
    text: Color(0xFF16151C),
    text2: Color(0xFF4A4857),
    muted: Color(0xFF74727F),
    primary: Color(0xFF7C3AED),
    primarySoft: Color(0xFFF1EBFE),
    primarySolid: Color(0xFF7C3AED),
    trust: Color(0xFF0F766E),
    trustSoft: Color(0xFFE6F7F5),
    money: Color(0xFFA16207),
    moneySoft: Color(0xFFFDF4E3),
    ok: Color(0xFF15803D),
    okSoft: Color(0xFFE8F6EC),
    warn: Color(0xFFB45309),
    warnSoft: Color(0xFFFEF3E2),
    bad: Color(0xFFDC2626),
    badSoft: Color(0xFFFDECEC),
    info: Color(0xFF2563EB),
    infoSoft: Color(0xFFEAF1FE),
    charts: [Color(0xFF7C3AED), Color(0xFF0D9488), Color(0xFFD97706), Color(0xFFDB2777), Color(0xFF2563EB)],
  );

  static const dark = AppColors(
    bg: Color(0xFF0B0A10),
    surface: Color(0xFF131219),
    surface2: Color(0xFF1A1922),
    surface3: Color(0xFF23222D),
    line: Color(0xFF262531),
    lineStrong: Color(0xFF34333F),
    text: Color(0xFFF1F0F5),
    text2: Color(0xFFB9B7C6),
    muted: Color(0xFF8A889A),
    primary: Color(0xFF8B5CF6),
    primarySoft: Color(0xFF221A38),
    primarySolid: Color(0xFF7C3AED),
    trust: Color(0xFF5EEAD4),
    trustSoft: Color(0xFF11292A),
    money: Color(0xFFF5C451),
    moneySoft: Color(0xFF2A2213),
    ok: Color(0xFF4ADE80),
    okSoft: Color(0xFF12261A),
    warn: Color(0xFFFBBF24),
    warnSoft: Color(0xFF2A2110),
    bad: Color(0xFFF87171),
    badSoft: Color(0xFF2C1517),
    info: Color(0xFF60A5FA),
    infoSoft: Color(0xFF111F33),
    charts: [Color(0xFF8B5CF6), Color(0xFF14A394), Color(0xFFC07F12), Color(0xFFE0478F), Color(0xFF3B82F6)],
  );

  static AppColors of(BuildContext context) => Theme.of(context).extension<AppColors>()!;

  @override
  AppColors copyWith() => this;

  @override
  AppColors lerp(ThemeExtension<AppColors>? other, double t) => (other is AppColors && t > 0.5) ? other : this;
}

/// Badge tones, as on the web (labels.ts → Tone).
enum Tone { neutral, primary, trust, money, ok, warn, bad, info, outline }

extension ToneColors on AppColors {
  (Color bg, Color fg) tone(Tone t) => switch (t) {
        Tone.neutral => (surface3, text2),
        Tone.primary => (primarySoft, primary),
        Tone.trust => (trustSoft, trust),
        Tone.money => (moneySoft, money),
        Tone.ok => (okSoft, ok),
        Tone.warn => (warnSoft, warn),
        Tone.bad => (badSoft, bad),
        Tone.info => (infoSoft, info),
        Tone.outline => (Colors.transparent, text2),
      };
}
