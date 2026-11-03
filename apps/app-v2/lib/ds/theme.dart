import 'package:flutter/material.dart';

import 'tokens.g.dart';
import 'tone.dart';

export 'tokens.g.dart';

/// Sizes shared by every screen: one place, like the web's design system.
abstract final class Gap {
  static const xs = 4.0, sm = 8.0, md = 12.0, lg = 16.0, xl = 24.0;
  static const radius = 12.0, radiusSm = 8.0;

  /// Smallest thing a finger presses.
  static const tap = 48.0;
}

extension ThemeColors on BuildContext {
  AppColors get colors => Theme.of(this).extension<AppColors>()!;
  TextTheme get text => Theme.of(this).textTheme;
}

extension ToneColors on AppColors {
  Color fg(Tone t) => switch (t) { Tone.neutral => text2, Tone.info => info, Tone.ok => ok, Tone.warn => warn, Tone.bad => bad };
  Color soft(Tone t) => switch (t) { Tone.neutral => surface2, Tone.info => infoSoft, Tone.ok => okSoft, Tone.warn => warnSoft, Tone.bad => badSoft };
}

ThemeData appTheme(Brightness b) {
  final c = b == Brightness.dark ? AppColors.dark : AppColors.light;
  final scheme = ColorScheme(
    brightness: b,
    primary: c.primarySolid,
    onPrimary: c.primaryFg,
    secondary: c.trust,
    onSecondary: c.primaryFg,
    error: c.bad,
    onError: c.primaryFg,
    surface: c.surface,
    onSurface: c.text,
    onSurfaceVariant: c.text2,
    outline: c.lineStrong,
    outlineVariant: c.line,
    surfaceContainerLowest: c.bg,
    surfaceContainerLow: c.surface,
    surfaceContainer: c.surface2,
    surfaceContainerHigh: c.surface2,
    surfaceContainerHighest: c.surface3,
  );
  const font = TextTheme(
    titleLarge: TextStyle(fontSize: 20, height: 26 / 20, fontWeight: FontWeight.w700),
    titleMedium: TextStyle(fontSize: 15, height: 20 / 15, fontWeight: FontWeight.w600),
    titleSmall: TextStyle(fontSize: 14, height: 20 / 14, fontWeight: FontWeight.w500),
    bodyLarge: TextStyle(fontSize: 16, height: 22 / 16),
    bodyMedium: TextStyle(fontSize: 14, height: 20 / 14),
    bodySmall: TextStyle(fontSize: 13, height: 18 / 13),
    labelLarge: TextStyle(fontSize: 15, height: 20 / 15, fontWeight: FontWeight.w600),
    labelMedium: TextStyle(fontSize: 13, height: 18 / 13, fontWeight: FontWeight.w500),
    labelSmall: TextStyle(fontSize: 12, height: 16 / 12, fontWeight: FontWeight.w500),
  );
  final text = font.apply(fontFamily: 'Inter', bodyColor: c.text, displayColor: c.text);
  final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(Gap.radiusSm));
  const minSize = Size(Gap.tap, Gap.tap);
  OutlineInputBorder border(Color col, [double w = 1]) =>
      OutlineInputBorder(borderRadius: BorderRadius.circular(Gap.radiusSm), borderSide: BorderSide(color: col, width: w));
  return ThemeData(
    useMaterial3: true,
    brightness: b,
    fontFamily: 'Inter',
    colorScheme: scheme,
    extensions: [c],
    scaffoldBackgroundColor: c.bg,
    textTheme: text,
    dividerColor: c.line,
    dividerTheme: DividerThemeData(color: c.line, space: 1, thickness: 1),
    materialTapTargetSize: MaterialTapTargetSize.padded,
    appBarTheme: AppBarTheme(
      backgroundColor: c.bg,
      foregroundColor: c.text,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: text.titleLarge,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: c.primarySolid,
        foregroundColor: c.primaryFg,
        minimumSize: minSize,
        shape: shape,
        textStyle: text.labelLarge,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: c.text,
        side: BorderSide(color: c.lineStrong),
        minimumSize: minSize,
        shape: shape,
        textStyle: text.labelLarge,
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(foregroundColor: c.primary, minimumSize: minSize, shape: shape, textStyle: text.labelLarge),
    ),
    iconButtonTheme: IconButtonThemeData(style: IconButton.styleFrom(minimumSize: minSize, foregroundColor: c.text2)),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: c.surface,
      isDense: false,
      contentPadding: const EdgeInsets.symmetric(horizontal: Gap.md, vertical: Gap.md),
      border: border(c.lineStrong),
      enabledBorder: border(c.lineStrong),
      focusedBorder: border(c.primary, 2),
      errorBorder: border(c.bad),
      focusedErrorBorder: border(c.bad, 2),
      hintStyle: text.bodyMedium?.copyWith(color: c.muted),
      errorStyle: text.bodySmall?.copyWith(color: c.bad),
      helperStyle: text.bodySmall?.copyWith(color: c.muted),
      helperMaxLines: 3,
      errorMaxLines: 3,
    ),
    chipTheme: ChipThemeData(
      backgroundColor: c.surface,
      selectedColor: c.primarySoft,
      side: BorderSide(color: c.line),
      labelStyle: text.labelMedium,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
      showCheckmark: false,
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: c.surface,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
      dragHandleColor: c.lineStrong,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: c.surface,
      indicatorColor: c.primarySoft,
      surfaceTintColor: Colors.transparent,
      height: 68,
      labelTextStyle: WidgetStateProperty.resolveWith((s) =>
          text.labelSmall?.copyWith(color: s.contains(WidgetState.selected) ? c.primary : c.text2)),
      iconTheme: WidgetStateProperty.resolveWith(
          (s) => IconThemeData(color: s.contains(WidgetState.selected) ? c.primary : c.text2, size: 24)),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: c.text,
      contentTextStyle: text.bodyMedium?.copyWith(color: c.bg),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Gap.radiusSm)),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? c.primaryFg : c.surface),
      trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? c.primarySolid : c.lineStrong),
      trackOutlineColor: const WidgetStatePropertyAll(Colors.transparent),
    ),
    dialogTheme: DialogThemeData(backgroundColor: c.surface, surfaceTintColor: Colors.transparent),
    popupMenuTheme: PopupMenuThemeData(color: c.surface, surfaceTintColor: Colors.transparent, textStyle: text.bodyMedium),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: c.primary),
  );
}
