import 'package:flutter/material.dart';

import '../feel.dart';
import '../theme.dart';

/// The one way anything in the app is pressed. It gives every control the same feel:
/// a soft spring to 97% while held, a light haptic on tap, a visible focus ring for
/// keyboards and switch access, and a hit area of at least [KSize.touch].
class Pressable extends StatefulWidget {
  const Pressable({
    super.key,
    required this.child,
    required this.onPressed,
    this.semanticLabel,
    this.isButton = true,
    this.haptic = true,
    this.scale = 0.97,
    this.borderRadius = const BorderRadius.all(Radius.circular(KRadius.md)),
    this.minSize = KSize.touch,
    this.selected,
  });

  final Widget child;

  /// Null disables the control (it is still announced, as disabled).
  final VoidCallback? onPressed;
  final String? semanticLabel;
  final bool isButton;
  final bool haptic;
  final double scale;
  final BorderRadius borderRadius;
  final double minSize;

  /// For toggles: announced as selected or not.
  final bool? selected;

  @override
  State<Pressable> createState() => _PressableState();
}

class _PressableState extends State<Pressable> {
  bool _down = false;
  bool _focused = false;

  bool get _enabled => widget.onPressed != null;

  void _activate() {
    if (!_enabled) return;
    if (widget.haptic) KHaptics.tap();
    widget.onPressed!();
  }

  @override
  Widget build(BuildContext context) {
    final motion = KMotion.of(context);
    return Semantics(
      container: true,
      button: widget.isButton,
      selected: widget.selected,
      enabled: _enabled,
      label: widget.semanticLabel,
      child: FocusableActionDetector(
        enabled: _enabled,
        mouseCursor: _enabled ? SystemMouseCursors.click : SystemMouseCursors.basic,
        onShowFocusHighlight: (v) => setState(() => _focused = v),
        actions: {ActivateIntent: CallbackAction<ActivateIntent>(onInvoke: (_) => _activate())},
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTapDown: _enabled ? (_) => setState(() => _down = true) : null,
          onTapCancel: () => setState(() => _down = false),
          onTapUp: _enabled ? (_) => setState(() => _down = false) : null,
          onTap: _enabled ? _activate : null,
          excludeFromSemantics: true,
          child: ConstrainedBox(
            constraints: BoxConstraints(minWidth: widget.minSize, minHeight: widget.minSize),
            child: AnimatedScale(
              scale: _down && !motion.reduced ? widget.scale : 1,
              duration: motion.instant,
              curve: _down ? KMotion.standardCurve : KMotion.press,
              child: DecoratedBox(
                position: DecorationPosition.foreground,
                decoration: BoxDecoration(
                  borderRadius: widget.borderRadius,
                  border: _focused ? Border.all(color: context.k.focus, width: 2) : null,
                ),
                child: Center(widthFactor: 1, heightFactor: 1, child: widget.child),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
