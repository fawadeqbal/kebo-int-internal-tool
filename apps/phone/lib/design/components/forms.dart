import 'package:flutter/material.dart';

import '../feel.dart';
import '../theme.dart';
import 'button.dart';
import 'content.dart';

/// The bar pinned to the bottom of a form or record: the screen's one primary action in
/// the thumb zone, with an optional secondary. Rides above the keyboard.
class KStickyBar extends StatelessWidget {
  const KStickyBar({super.key, required this.primary, this.secondary, this.note});

  final KButton primary;
  final KButton? secondary;

  /// A short line above the buttons ("Total USD 18,400 · 2 files").
  final String? note;

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    return Container(
      decoration: BoxDecoration(
        color: c.surface,
        border: Border(top: BorderSide(color: c.line)),
      ),
      padding: const EdgeInsets.fromLTRB(KSpace.s4, KSpace.s3, KSpace.s4, KSpace.s3),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (note != null) ...[
              Text(note!, style: KType.footnote.copyWith(color: c.inkMuted)),
              const SizedBox(height: KSpace.s2),
            ],
            Row(
              children: [
                if (secondary != null) ...[Expanded(child: secondary!), const SizedBox(width: KSpace.s3)],
                // The forward action gets twice the room, so its label is never cut.
                Expanded(flex: secondary == null ? 1 : 2, child: primary),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// One section of a [KStepForm].
class KFormStep {
  const KFormStep({required this.title, required this.builder, this.validate});

  final String title;
  final WidgetBuilder builder;

  /// Returns an error message to stop on this step, or null to go on.
  final String? Function()? validate;
}

/// A long form split into logical steps, ending in a review step that shows every value
/// (empty ones say "Not set") before anything is saved. Back never loses input.
class KStepForm extends StatefulWidget {
  const KStepForm({
    super.key,
    required this.steps,
    required this.review,
    required this.submitLabel,
    required this.onSubmit,
  });

  final List<KFormStep> steps;

  /// The review step's body: usually [KDetails] cards with an Edit that jumps back.
  final Widget Function(BuildContext context, void Function(int step) goTo) review;
  final String submitLabel;
  final Future<void> Function() onSubmit;

  @override
  State<KStepForm> createState() => _KStepFormState();
}

class _KStepFormState extends State<KStepForm> {
  int _i = 0;
  String? _error;
  bool _busy = false;

  int get _count => widget.steps.length + 1;
  bool get _onReview => _i == widget.steps.length;

  void _go(int i) {
    setState(() {
      _i = i;
      _error = null;
    });
  }

  void _next() {
    final err = widget.steps[_i].validate?.call();
    if (err != null) {
      KHaptics.error();
      setState(() => _error = err);
      return;
    }
    _go(_i + 1);
  }

  Future<void> _submit() async {
    setState(() => _busy = true);
    try {
      await widget.onSubmit();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    final m = KMotion.of(context);
    final title = _onReview ? 'Review' : widget.steps[_i].title;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(KSpace.s4, KSpace.s3, KSpace.s4, KSpace.s2),
          child: KSteps(
            steps: [
              for (var j = 0; j < _count; j++)
                (
                  j == widget.steps.length ? 'Review' : widget.steps[j].title,
                  j < _i ? KStepState.done : (j == _i ? KStepState.current : KStepState.todo),
                ),
            ],
          ),
        ),
        Expanded(
          child: AnimatedSwitcher(
            duration: m.standard,
            switchInCurve: KMotion.enter,
            switchOutCurve: KMotion.exit,
            child: ListView(
              key: ValueKey(_i),
              padding: const EdgeInsets.all(KSpace.s4),
              children: [
                Semantics(
                  header: true,
                  child: Text(title, style: KType.title2.copyWith(color: c.ink)),
                ),
                const SizedBox(height: KSpace.s4),
                if (_error != null) ...[
                  Semantics(
                    liveRegion: true,
                    child: Text(_error!, style: KType.callout.copyWith(color: c.danger)),
                  ),
                  const SizedBox(height: KSpace.s3),
                ],
                if (_onReview) widget.review(context, _go) else widget.steps[_i].builder(context),
              ],
            ),
          ),
        ),
        KStickyBar(
          secondary: _i == 0
              ? null
              : KButton('Back', variant: KButtonVariant.secondary, onPressed: _busy ? null : () => _go(_i - 1)),
          primary: _onReview
              ? KButton(widget.submitLabel, loading: _busy, onPressed: _submit, fullWidth: true)
              : KButton(_i == widget.steps.length - 1 ? 'Review' : 'Continue', onPressed: _next, fullWidth: true),
        ),
      ],
    );
  }
}
