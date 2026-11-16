import 'package:flutter/material.dart';

import '../feel.dart';
import '../icons.dart';
import '../theme.dart';
import 'button.dart';
import 'pressable.dart';

/// Kestrel › BottomSheet: options, filters, pickers and short forms, in the thumb zone.
/// Dismiss by drag, scrim, back or the close button. With [unsaved], dismissing asks first.
Future<T?> showKSheet<T>(
  BuildContext context, {
  required String title,
  required WidgetBuilder builder,
  bool Function()? unsaved,
  Widget? footer,
}) {
  final c = context.k;
  final m = KMotion.of(context);
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: c.surfaceRaised,
    barrierColor: c.scrim,
    sheetAnimationStyle: AnimationStyle(duration: m.standard, reverseDuration: m.quick),
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(KRadius.xl))),
    builder: (ctx) => PopScope(
      canPop: unsaved == null || !unsaved(),
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final leave = await showKConfirm(
          ctx,
          title: 'Discard your changes?',
          message: 'What you entered in “$title” will be lost.',
          confirmLabel: 'Discard',
          destructive: true,
        );
        if (leave == true && ctx.mounted) Navigator.of(ctx).pop();
      },
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(ctx).bottom),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                margin: const EdgeInsets.only(top: KSpace.s2),
                width: 36,
                height: 4,
                decoration: BoxDecoration(color: c.lineStrong, borderRadius: BorderRadius.circular(KRadius.full)),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(KSpace.s4, KSpace.s2, KSpace.s1, 0),
              child: Row(
                children: [
                  Expanded(
                    child: Semantics(
                      header: true,
                      child: Text(title, style: KType.title3.copyWith(color: c.ink)),
                    ),
                  ),
                  Pressable(
                    semanticLabel: 'Close',
                    onPressed: () => Navigator.of(ctx).maybePop(),
                    child: KIcon(KIcons.close, color: c.inkMuted),
                  ),
                ],
              ),
            ),
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(KSpace.s4, KSpace.s2, KSpace.s4, KSpace.s4),
                child: builder(ctx),
              ),
            ),
            if (footer != null)
              Container(
                padding: const EdgeInsets.fromLTRB(KSpace.s4, KSpace.s3, KSpace.s4, KSpace.s4),
                decoration: BoxDecoration(
                  border: Border(top: BorderSide(color: c.line)),
                ),
                child: SafeArea(top: false, child: footer),
              ),
          ],
        ),
      ),
    ),
  );
}

/// Kestrel › Dialog, for irreversible or costly decisions only. The title names the object
/// as a question; the confirm button repeats the verb. Scrim, back and Escape mean cancel.
Future<bool?> showKConfirm(
  BuildContext context, {
  required String title,
  required String message,
  required String confirmLabel,
  String cancelLabel = 'Cancel',
  bool destructive = false,
}) {
  final c = context.k;
  final m = KMotion.of(context);
  if (destructive) KHaptics.warning();
  return showGeneralDialog<bool>(
    context: context,
    barrierDismissible: true,
    barrierLabel: cancelLabel,
    barrierColor: c.scrim,
    transitionDuration: m.standard,
    transitionBuilder: (_, a, _, child) => FadeTransition(
      opacity: a,
      child: m.reduced
          ? child
          : ScaleTransition(
              scale: Tween(begin: 0.96, end: 1.0).animate(CurvedAnimation(parent: a, curve: KMotion.standardCurve)),
              child: child,
            ),
    ),
    pageBuilder: (ctx, _, _) => Center(
      child: Padding(
        padding: const EdgeInsets.all(KSpace.s6),
        child: Material(
          color: c.surfaceRaised,
          borderRadius: BorderRadius.circular(KRadius.xl),
          elevation: 0,
          child: Semantics(
            scopesRoute: true,
            namesRoute: true,
            explicitChildNodes: true,
            label: title,
            child: Container(
              constraints: const BoxConstraints(maxWidth: 400),
              decoration: BoxDecoration(borderRadius: BorderRadius.circular(KRadius.xl), boxShadow: c.elevation3),
              padding: const EdgeInsets.all(KSpace.s6),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(title, style: KType.title3.copyWith(color: c.ink)),
                  const SizedBox(height: KSpace.s2),
                  Text(message, style: KType.body.copyWith(color: c.inkMuted)),
                  const SizedBox(height: KSpace.s6),
                  Wrap(
                    alignment: WrapAlignment.end,
                    spacing: KSpace.s2,
                    runSpacing: KSpace.s2,
                    children: [
                      KButton(
                        cancelLabel,
                        variant: KButtonVariant.tertiary,
                        onPressed: () => Navigator.of(ctx).pop(false),
                      ),
                      KButton(
                        confirmLabel,
                        variant: destructive ? KButtonVariant.danger : KButtonVariant.primary,
                        onPressed: () => Navigator.of(ctx).pop(true),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

/// Kestrel › Toast: brief feedback for what you just did. One at a time; 4 s, or 6 s with
/// an action ("Undo"). The snack bar is a live region, so it is announced. Never for
/// anything that must be read.
void showKToast(BuildContext context, String message, {String? actionLabel, VoidCallback? onAction, KIconData? icon}) {
  assert(message.length <= 80, 'Keep toasts to one short line.');
  final messenger = ScaffoldMessenger.of(context);
  final c = context.k;
  messenger.hideCurrentSnackBar();
  messenger.showSnackBar(
    SnackBar(
      behavior: SnackBarBehavior.floating,
      duration: Duration(seconds: actionLabel == null ? 4 : 6),
      backgroundColor: c.ink,
      elevation: 0,
      margin: const EdgeInsets.fromLTRB(KSpace.s4, 0, KSpace.s4, KSpace.s4),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(KRadius.md)),
      content: Row(
        children: [
          if (icon != null) ...[KIcon(icon, size: 20, color: c.bg), const SizedBox(width: KSpace.s2)],
          Expanded(
            child: Text(message, style: KType.callout.copyWith(color: c.bg)),
          ),
        ],
      ),
      action: actionLabel == null
          ? null
          : SnackBarAction(label: actionLabel, textColor: c.primarySoft, onPressed: onAction ?? () {}),
    ),
  );
}
