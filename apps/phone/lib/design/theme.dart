import 'package:flutter/material.dart';

import 'tokens.g.dart';

export 'tokens.g.dart';

/// Builds the app's [ThemeData] from Kestrel tokens. Components read colours from
/// [KColors] (`context.k`), never from Material's colour scheme, so light and dark
/// stay exactly as the design system defines them.
abstract final class KTheme {
  static ThemeData light() => _build(KColors.light, Brightness.light);
  static ThemeData dark() => _build(KColors.dark, Brightness.dark);

  static ThemeData _build(KColors c, Brightness brightness) {
    final scheme = ColorScheme(
      brightness: brightness,
      primary: c.primary,
      onPrimary: c.onPrimary,
      secondary: c.accent,
      onSecondary: c.onAccent,
      error: c.danger,
      onError: c.onDanger,
      surface: c.surface,
      onSurface: c.ink,
      surfaceContainerLowest: c.bg,
      outline: c.lineStrong,
      outlineVariant: c.line,
    );
    final text = const TextTheme(
      displayLarge: KType.display,
      headlineLarge: KType.title1,
      headlineMedium: KType.title2,
      titleLarge: KType.title3,
      bodyLarge: KType.body,
      bodyMedium: KType.callout,
      labelLarge: KType.label,
      labelMedium: KType.labelSm,
      bodySmall: KType.footnote,
      labelSmall: KType.caption,
    ).apply(bodyColor: c.ink, displayColor: c.ink);

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: c.bg,
      fontFamily: KType.family,
      textTheme: text,
      extensions: [c],
      splashFactory: NoSplash.splashFactory, // Kestrel uses its own press feedback (Pressable).
      highlightColor: Colors.transparent,
      dividerTheme: DividerThemeData(color: c.line, thickness: 1, space: 1),
      focusColor: c.focus,
      materialTapTargetSize: MaterialTapTargetSize.padded,
      visualDensity: VisualDensity.standard,
    );
  }
}

extension KContext on BuildContext {
  /// The current theme's Kestrel colours and elevation.
  KColors get k => Theme.of(this).extension<KColors>()!;
}
