import 'package:flutter/material.dart';

import '../icons.dart';
import '../theme.dart';
import 'pressable.dart';
import 'spinner.dart';

enum KButtonVariant { primary, secondary, tertiary, danger }

enum KButtonSize { md, lg }

/// Kestrel › Button. At most one [KButtonVariant.primary] per screen; verbs first,
/// sentence case. While [loading], the label stays (it says what is happening) and
/// the button can't be pressed twice.
class KButton extends StatelessWidget {
  const KButton(
    this.label, {
    super.key,
    required this.onPressed,
    this.variant = KButtonVariant.primary,
    this.size = KButtonSize.md,
    this.icon,
    this.loading = false,
    this.fullWidth = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final KButtonVariant variant;
  final KButtonSize size;
  final KIconData? icon;
  final bool loading;
  final bool fullWidth;

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    final enabled = onPressed != null && !loading;
    final (Color bg, Color fg, Color? border) = switch (variant) {
      KButtonVariant.primary => (c.primary, c.onPrimary, null),
      KButtonVariant.secondary => (c.surface, c.primary, c.lineStrong),
      KButtonVariant.tertiary => (Colors.transparent, c.primary, null),
      KButtonVariant.danger => (c.danger, c.onDanger, null),
    };
    final height = size == KButtonSize.lg ? KSize.controlLg : KSize.control;
    final hPad = variant == KButtonVariant.tertiary ? KSpace.s3 : (size == KButtonSize.lg ? KSpace.s6 : KSpace.s5);
    final text = (size == KButtonSize.lg ? KType.label.copyWith(fontSize: 16) : KType.label).copyWith(color: fg);

    Widget content = Row(
      mainAxisSize: fullWidth ? MainAxisSize.max : MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (loading) ...[
          KSpinner(color: fg, size: 20),
          const SizedBox(width: KSpace.s2),
        ] else if (icon != null) ...[
          KIcon(icon!, size: 20, color: fg),
          const SizedBox(width: KSpace.s2),
        ],
        Flexible(
          child: Text(label, style: text, maxLines: 1, overflow: TextOverflow.ellipsis),
        ),
      ],
    );

    content = AnimatedOpacity(
      opacity: onPressed == null && !loading ? KOpacity.disabled : 1,
      duration: const Duration(milliseconds: 100),
      child: Container(
        height: height,
        width: fullWidth ? double.infinity : null,
        padding: EdgeInsets.symmetric(horizontal: hPad),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(KRadius.md),
          border: border == null ? null : Border.all(color: border),
        ),
        child: content,
      ),
    );

    return Semantics(
      label: loading ? '$label, in progress' : null,
      excludeSemantics: loading,
      child: Pressable(
        onPressed: enabled ? onPressed : null,
        semanticLabel: loading ? null : label,
        child: ExcludeSemantics(child: content),
      ),
    );
  }
}
