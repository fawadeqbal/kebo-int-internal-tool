import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'colors.dart';

/// Material theme built from the web's tokens: Geist, 12 px cards, 10 px
/// inputs, hairline borders, purple primary.
ThemeData buildTheme(Brightness brightness) {
  final c = brightness == Brightness.dark ? AppColors.dark : AppColors.light;
  final scheme = ColorScheme(
    brightness: brightness,
    primary: c.primarySolid,
    onPrimary: Colors.white,
    primaryContainer: c.primarySoft,
    onPrimaryContainer: c.primary,
    secondary: c.trust,
    onSecondary: Colors.white,
    error: c.bad,
    onError: Colors.white,
    surface: c.surface,
    onSurface: c.text,
    onSurfaceVariant: c.muted,
    surfaceContainerLowest: c.surface,
    surfaceContainerLow: c.surface,
    surfaceContainer: c.surface2,
    surfaceContainerHigh: c.surface2,
    surfaceContainerHighest: c.surface3,
    outline: c.lineStrong,
    outlineVariant: c.line,
  );

  const font = 'Geist';
  final base = ThemeData(brightness: brightness, useMaterial3: true, fontFamily: font, colorScheme: scheme);
  final text = base.textTheme.apply(bodyColor: c.text, displayColor: c.text, fontFamily: font).copyWith(
        headlineSmall: TextStyle(fontFamily: font, fontSize: 22, fontWeight: FontWeight.w600, letterSpacing: -0.4, color: c.text),
        titleLarge: TextStyle(fontFamily: font, fontSize: 18, fontWeight: FontWeight.w600, letterSpacing: -0.2, color: c.text),
        titleMedium: TextStyle(fontFamily: font, fontSize: 15, fontWeight: FontWeight.w600, color: c.text),
        titleSmall: TextStyle(fontFamily: font, fontSize: 14, fontWeight: FontWeight.w600, color: c.text),
        bodyLarge: TextStyle(fontFamily: font, fontSize: 15, height: 1.45, color: c.text),
        bodyMedium: TextStyle(fontFamily: font, fontSize: 14, height: 1.45, color: c.text),
        bodySmall: TextStyle(fontFamily: font, fontSize: 12.5, height: 1.4, color: c.muted),
        labelLarge: const TextStyle(fontFamily: font, fontSize: 14, fontWeight: FontWeight.w600),
        labelMedium: TextStyle(fontFamily: font, fontSize: 12.5, fontWeight: FontWeight.w500, color: c.text2),
        labelSmall: TextStyle(fontFamily: font, fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 0.6, color: c.muted),
      );

  OutlineInputBorder border(Color color, [double width = 1]) =>
      OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: color, width: width));

  final buttonShape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(10));
  const buttonPadding = EdgeInsets.symmetric(horizontal: 16, vertical: 12);

  return base.copyWith(
    extensions: [c],
    scaffoldBackgroundColor: c.bg,
    textTheme: text,
    splashFactory: InkSparkle.splashFactory,
    dividerTheme: DividerThemeData(color: c.line, thickness: 1, space: 1),
    appBarTheme: AppBarTheme(
      backgroundColor: c.bg,
      surfaceTintColor: Colors.transparent,
      foregroundColor: c.text,
      elevation: 0,
      scrolledUnderElevation: 0.5,
      shadowColor: c.line,
      centerTitle: false,
      titleTextStyle: TextStyle(fontFamily: font, fontSize: 18, fontWeight: FontWeight.w600, letterSpacing: -0.2, color: c.text),
      systemOverlayStyle: brightness == Brightness.dark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark,
    ),
    cardTheme: CardThemeData(
      color: c.surface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: BorderSide(color: c.line)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: c.surface,
      hoverColor: Colors.transparent,
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 13),
      hintStyle: TextStyle(color: c.muted, fontSize: 14),
      labelStyle: TextStyle(color: c.text2, fontSize: 14),
      floatingLabelStyle: TextStyle(color: c.primary, fontSize: 14),
      helperStyle: TextStyle(color: c.muted, fontSize: 12),
      errorStyle: TextStyle(color: c.bad, fontSize: 12),
      border: border(c.lineStrong),
      enabledBorder: border(c.lineStrong),
      focusedBorder: border(c.primary, 1.6),
      errorBorder: border(c.bad),
      focusedErrorBorder: border(c.bad, 1.6),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: c.primarySolid,
        foregroundColor: Colors.white,
        disabledBackgroundColor: c.surface3,
        shape: buttonShape,
        padding: buttonPadding,
        textStyle: const TextStyle(fontFamily: font, fontSize: 14, fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: c.text,
        side: BorderSide(color: c.lineStrong),
        backgroundColor: c.surface,
        shape: buttonShape,
        padding: buttonPadding,
        textStyle: const TextStyle(fontFamily: font, fontSize: 14, fontWeight: FontWeight.w600),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: c.primary,
        shape: buttonShape,
        textStyle: const TextStyle(fontFamily: font, fontSize: 14, fontWeight: FontWeight.w600),
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: c.surface,
      selectedColor: c.primarySoft,
      side: BorderSide(color: c.line),
      labelStyle: TextStyle(fontFamily: font, fontSize: 13, fontWeight: FontWeight.w500, color: c.text2),
      secondaryLabelStyle: TextStyle(fontFamily: font, fontSize: 13, fontWeight: FontWeight.w600, color: c.primary),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
      showCheckmark: false,
      padding: const EdgeInsets.symmetric(horizontal: 4),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: c.surface,
      surfaceTintColor: Colors.transparent,
      indicatorColor: c.primarySoft,
      elevation: 0,
      height: 66,
      labelTextStyle: WidgetStateProperty.resolveWith(
        (s) => TextStyle(fontFamily: font, fontSize: 11.5, fontWeight: s.contains(WidgetState.selected) ? FontWeight.w600 : FontWeight.w500, color: s.contains(WidgetState.selected) ? c.primary : c.muted),
      ),
      iconTheme: WidgetStateProperty.resolveWith((s) => IconThemeData(size: 22, color: s.contains(WidgetState.selected) ? c.primary : c.muted)),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: c.surface,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
      dragHandleColor: c.lineStrong,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: c.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      titleTextStyle: TextStyle(fontFamily: font, fontSize: 17, fontWeight: FontWeight.w600, color: c.text),
      contentTextStyle: TextStyle(fontFamily: font, fontSize: 14, height: 1.45, color: c.text2),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: brightness == Brightness.dark ? c.surface3 : c.text,
      contentTextStyle: TextStyle(fontFamily: font, fontSize: 14, color: brightness == Brightness.dark ? c.text : Colors.white),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
    ),
    listTileTheme: ListTileThemeData(iconColor: c.muted, textColor: c.text, contentPadding: const EdgeInsets.symmetric(horizontal: 16)),
    floatingActionButtonTheme: FloatingActionButtonThemeData(
      backgroundColor: c.primarySolid,
      foregroundColor: Colors.white,
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: c.primary, linearTrackColor: c.surface3),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? Colors.white : c.muted),
      trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? c.primarySolid : c.surface3),
      trackOutlineColor: WidgetStateProperty.all(Colors.transparent),
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: SegmentedButton.styleFrom(
        backgroundColor: c.surface,
        selectedBackgroundColor: c.primarySoft,
        selectedForegroundColor: c.primary,
        foregroundColor: c.text2,
        side: BorderSide(color: c.line),
        textStyle: const TextStyle(fontFamily: font, fontSize: 13, fontWeight: FontWeight.w600),
      ),
    ),
  );
}
