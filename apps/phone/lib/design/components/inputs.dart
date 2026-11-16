import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../feel.dart';
import '../icons.dart';
import '../theme.dart';
import 'pressable.dart';

/// Kestrel › TextField. The label always stays visible above the field (never a
/// placeholder-only field). Help text sits under it; an error replaces the help text,
/// is announced, and carries an icon so it doesn't rely on colour.
class KTextField extends StatefulWidget {
  const KTextField({
    super.key,
    required this.label,
    this.controller,
    this.initialValue,
    this.hint,
    this.help,
    this.error,
    this.optional = false,
    this.enabled = true,
    this.readOnly = false,
    this.obscure = false,
    this.multiline = false,
    this.keyboardType,
    this.textInputAction,
    this.inputFormatters,
    this.prefix,
    this.suffix,
    this.trailingIcon,
    this.onTrailingPressed,
    this.trailingLabel,
    this.onChanged,
    this.onSubmitted,
    this.onTap,
    this.autofillHints,
    this.maxLength,
    this.focusNode,
  });

  final String label;
  final TextEditingController? controller;
  final String? initialValue;
  final String? hint;
  final String? help;
  final String? error;

  /// Shows "Optional" next to the label. Required is the default and isn't marked.
  final bool optional;
  final bool enabled;
  final bool readOnly;
  final bool obscure;
  final bool multiline;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final List<TextInputFormatter>? inputFormatters;

  /// Short text before the value, e.g. a currency ("USD").
  final String? prefix;
  final String? suffix;
  final KIconData? trailingIcon;
  final VoidCallback? onTrailingPressed;
  final String? trailingLabel;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final VoidCallback? onTap;
  final Iterable<String>? autofillHints;
  final int? maxLength;
  final FocusNode? focusNode;

  @override
  State<KTextField> createState() => _KTextFieldState();
}

class _KTextFieldState extends State<KTextField> {
  late final FocusNode _focus = widget.focusNode ?? FocusNode();
  late final TextEditingController _ctrl = widget.controller ?? TextEditingController(text: widget.initialValue);

  @override
  void initState() {
    super.initState();
    _focus.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    if (widget.focusNode == null) _focus.dispose();
    if (widget.controller == null) _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    final hasError = widget.error != null && widget.error!.isNotEmpty;
    final borderColor = hasError
        ? c.danger
        : _focus.hasFocus
        ? c.primary
        : c.lineStrong;
    final width = _focus.hasFocus || hasError ? 2.0 : 1.0;

    return Opacity(
      opacity: widget.enabled ? 1 : KOpacity.disabled,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          ExcludeSemantics(
            child: Row(
              children: [
                Flexible(
                  child: Text(widget.label, style: KType.label.copyWith(color: c.ink)),
                ),
                if (widget.optional) Text('  Optional', style: KType.footnote.copyWith(color: c.inkMuted)),
              ],
            ),
          ),
          const SizedBox(height: KSpace.s2),
          AnimatedContainer(
            duration: KMotion.of(context).instant,
            constraints: BoxConstraints(minHeight: widget.multiline ? 96 : KSize.control),
            decoration: BoxDecoration(
              color: widget.readOnly ? c.surfaceSunken : c.surface,
              borderRadius: BorderRadius.circular(KRadius.md),
              border: Border.all(color: borderColor, width: width),
            ),
            padding: EdgeInsets.only(left: KSpace.s4, right: widget.trailingIcon == null ? KSpace.s4 : 0),
            child: Row(
              crossAxisAlignment: widget.multiline ? CrossAxisAlignment.start : CrossAxisAlignment.center,
              children: [
                if (widget.prefix != null)
                  Padding(
                    padding: const EdgeInsets.only(right: KSpace.s2),
                    child: Text(widget.prefix!, style: KType.body.copyWith(color: c.inkMuted)),
                  ),
                Expanded(
                  child: Semantics(
                    label: [
                      widget.label,
                      if (widget.optional) 'optional',
                      if (hasError) 'error: ${widget.error}',
                    ].join(', '),
                    hint: widget.help,
                    child: TextField(
                      controller: _ctrl,
                      focusNode: _focus,
                      enabled: widget.enabled,
                      readOnly: widget.readOnly || widget.onTap != null,
                      obscureText: widget.obscure,
                      minLines: widget.multiline ? 3 : 1,
                      maxLines: widget.multiline ? 8 : 1,
                      maxLength: widget.maxLength,
                      keyboardType: widget.multiline ? TextInputType.multiline : widget.keyboardType,
                      textInputAction: widget.textInputAction,
                      inputFormatters: widget.inputFormatters,
                      autofillHints: widget.autofillHints,
                      onChanged: widget.onChanged,
                      onSubmitted: widget.onSubmitted,
                      onTap: widget.onTap,
                      style: KType.body.copyWith(color: c.ink),
                      cursorColor: c.primary,
                      decoration: InputDecoration(
                        isCollapsed: true,
                        border: InputBorder.none,
                        counterText: '',
                        contentPadding: EdgeInsets.symmetric(vertical: widget.multiline ? KSpace.s3 : 14),
                        hintText: widget.hint,
                        hintStyle: KType.body.copyWith(color: c.inkMuted),
                      ),
                    ),
                  ),
                ),
                if (widget.suffix != null)
                  Padding(
                    padding: const EdgeInsets.only(left: KSpace.s2),
                    child: Text(widget.suffix!, style: KType.body.copyWith(color: c.inkMuted)),
                  ),
                if (widget.trailingIcon != null)
                  Pressable(
                    onPressed: widget.onTrailingPressed ?? widget.onTap,
                    semanticLabel: widget.trailingLabel,
                    isButton: widget.onTrailingPressed != null,
                    child: KIcon(widget.trailingIcon!, color: c.inkMuted),
                  ),
              ],
            ),
          ),
          if (hasError || widget.help != null) ...[
            const SizedBox(height: KSpace.s1),
            ExcludeSemantics(
              excluding: !hasError,
              child: Semantics(
                liveRegion: hasError,
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (hasError) ...[
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: KIcon(KIcons.error, size: 16, color: c.danger),
                      ),
                      const SizedBox(width: KSpace.s1),
                    ],
                    Expanded(
                      child: Text(
                        hasError ? widget.error! : widget.help!,
                        style: KType.footnote.copyWith(color: hasError ? c.danger : c.inkMuted),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// A field you tap to pick from a list, a date or a file: looks like a text field, opens
/// something. Shows [value] or the [placeholder].
class KSelectField extends StatelessWidget {
  const KSelectField({
    super.key,
    required this.label,
    required this.value,
    required this.onTap,
    this.placeholder = 'Choose',
    this.help,
    this.error,
    this.optional = false,
    this.icon = KIcons.chevronDown,
  });

  final String label;
  final String? value;
  final VoidCallback? onTap;
  final String placeholder;
  final String? help;
  final String? error;
  final bool optional;
  final KIconData icon;

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    final hasError = error != null && error!.isNotEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        ExcludeSemantics(
          child: Row(
            children: [
              Flexible(
                child: Text(label, style: KType.label.copyWith(color: c.ink)),
              ),
              if (optional) Text('  Optional', style: KType.footnote.copyWith(color: c.inkMuted)),
            ],
          ),
        ),
        const SizedBox(height: KSpace.s2),
        Pressable(
          onPressed: onTap,
          scale: 0.99,
          semanticLabel: '$label, ${value ?? 'not chosen'}${hasError ? ', error: $error' : ''}',
          child: Container(
            height: KSize.control,
            padding: const EdgeInsets.only(left: KSpace.s4, right: KSpace.s3),
            decoration: BoxDecoration(
              color: c.surface,
              borderRadius: BorderRadius.circular(KRadius.md),
              border: Border.all(color: hasError ? c.danger : c.lineStrong, width: hasError ? 2 : 1),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    value ?? placeholder,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: KType.body.copyWith(color: value == null ? c.inkMuted : c.ink),
                  ),
                ),
                KIcon(icon, color: c.inkMuted),
              ],
            ),
          ),
        ),
        if (hasError || help != null) ...[
          const SizedBox(height: KSpace.s1),
          Text(hasError ? error! : help!, style: KType.footnote.copyWith(color: hasError ? c.danger : c.inkMuted)),
        ],
      ],
    );
  }
}

/// Kestrel › SearchField. Pill shaped, with a clear button once there is text.
class KSearchField extends StatefulWidget {
  const KSearchField({super.key, this.hint = 'Search', this.controller, this.onChanged, this.autofocus = false});

  final String hint;
  final TextEditingController? controller;
  final ValueChanged<String>? onChanged;
  final bool autofocus;

  @override
  State<KSearchField> createState() => _KSearchFieldState();
}

class _KSearchFieldState extends State<KSearchField> {
  late final TextEditingController _ctrl = widget.controller ?? TextEditingController();

  @override
  void dispose() {
    if (widget.controller == null) _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    return Container(
      height: KSize.control,
      decoration: BoxDecoration(color: c.surfaceSunken, borderRadius: BorderRadius.circular(KRadius.full)),
      padding: const EdgeInsets.only(left: KSpace.s4),
      child: Row(
        children: [
          KIcon(KIcons.search, color: c.inkMuted, size: 20),
          const SizedBox(width: KSpace.s2),
          Expanded(
            child: Semantics(
              label: widget.hint,
              textField: true,
              child: TextField(
                controller: _ctrl,
                autofocus: widget.autofocus,
                textInputAction: TextInputAction.search,
                onChanged: (v) {
                  setState(() {});
                  widget.onChanged?.call(v);
                },
                style: KType.body.copyWith(color: c.ink),
                cursorColor: c.primary,
                decoration: InputDecoration(
                  isCollapsed: true,
                  border: InputBorder.none,
                  hintText: widget.hint,
                  hintStyle: KType.body.copyWith(color: c.inkMuted),
                ),
              ),
            ),
          ),
          if (_ctrl.text.isNotEmpty)
            Pressable(
              semanticLabel: 'Clear search',
              onPressed: () {
                _ctrl.clear();
                setState(() {});
                widget.onChanged?.call('');
              },
              child: KIcon(KIcons.close, color: c.inkMuted, size: 20),
            )
          else
            const SizedBox(width: KSpace.s4),
        ],
      ),
    );
  }
}

/// Kestrel › Checkbox, with its label as part of the 48px target.
class KCheckbox extends StatelessWidget {
  const KCheckbox({super.key, required this.label, required this.value, required this.onChanged, this.help});

  final String label;
  final bool value;
  final ValueChanged<bool>? onChanged;
  final String? help;

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    final m = KMotion.of(context);
    return _ToggleRow(
      label: label,
      help: help,
      checked: value,
      onTap: onChanged == null ? null : () => onChanged!(!value),
      control: AnimatedContainer(
        duration: m.instant,
        width: 22,
        height: 22,
        decoration: BoxDecoration(
          color: value ? c.primary : c.surface,
          borderRadius: BorderRadius.circular(KRadius.xs + 2),
          border: Border.all(color: value ? c.primary : c.lineStrong, width: 2),
        ),
        child: value ? KIcon(KIcons.check, size: 16, color: c.onPrimary) : null,
      ),
    );
  }
}

/// Kestrel › Radio. Use for 2–5 visible options; more go in a sheet.
class KRadio<T> extends StatelessWidget {
  const KRadio({
    super.key,
    required this.label,
    required this.value,
    required this.group,
    required this.onChanged,
    this.help,
  });

  final String label;
  final T value;
  final T? group;
  final ValueChanged<T>? onChanged;
  final String? help;

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    final on = value == group;
    return _ToggleRow(
      label: label,
      help: help,
      checked: on,
      inMutuallyExclusiveGroup: true,
      onTap: onChanged == null ? null : () => onChanged!(value),
      control: AnimatedContainer(
        duration: KMotion.of(context).instant,
        width: 22,
        height: 22,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: c.surface,
          border: Border.all(color: on ? c.primary : c.lineStrong, width: on ? 7 : 2),
        ),
      ),
    );
  }
}

class _ToggleRow extends StatelessWidget {
  const _ToggleRow({
    required this.label,
    required this.checked,
    required this.onTap,
    required this.control,
    this.help,
    this.inMutuallyExclusiveGroup = false,
  });

  final String label;
  final String? help;
  final bool checked;
  final VoidCallback? onTap;
  final Widget control;
  final bool inMutuallyExclusiveGroup;

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    return Semantics(
      container: true,
      checked: checked,
      inMutuallyExclusiveGroup: inMutuallyExclusiveGroup,
      enabled: onTap != null,
      label: label,
      hint: help,
      onTap: onTap,
      excludeSemantics: true,
      child: Opacity(
        opacity: onTap == null ? KOpacity.disabled : 1,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: onTap == null
              ? null
              : () {
                  KHaptics.toggle();
                  onTap!();
                },
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: KSize.touch),
            child: Row(
              children: [
                SizedBox(width: 32, child: Center(child: control)),
                const SizedBox(width: KSpace.s3),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: KSpace.s2),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(label, style: KType.body.copyWith(color: c.ink)),
                        if (help != null) Text(help!, style: KType.footnote.copyWith(color: c.inkMuted)),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Kestrel › Switch: a setting that takes effect at once. Use a checkbox inside forms.
class KSwitch extends StatelessWidget {
  const KSwitch({super.key, required this.label, required this.value, required this.onChanged, this.help});

  final String label;
  final bool value;
  final ValueChanged<bool>? onChanged;
  final String? help;

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    final m = KMotion.of(context);
    final enabled = onChanged != null;
    return Semantics(
      container: true,
      toggled: value,
      enabled: enabled,
      label: label,
      hint: help,
      onTap: enabled ? () => onChanged!(!value) : null,
      excludeSemantics: true,
      child: Opacity(
        opacity: enabled ? 1 : KOpacity.disabled,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: enabled
              ? () {
                  KHaptics.toggle();
                  onChanged!(!value);
                }
              : null,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: KSize.touch),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(label, style: KType.body.copyWith(color: c.ink)),
                      if (help != null) Text(help!, style: KType.footnote.copyWith(color: c.inkMuted)),
                    ],
                  ),
                ),
                const SizedBox(width: KSpace.s3),
                AnimatedContainer(
                  duration: m.quick,
                  curve: KMotion.standardCurve,
                  width: 52,
                  height: 32,
                  padding: const EdgeInsets.all(3),
                  decoration: BoxDecoration(
                    color: value ? c.primary : c.lineStrong,
                    borderRadius: BorderRadius.circular(KRadius.full),
                  ),
                  child: AnimatedAlign(
                    duration: m.quick,
                    curve: KMotion.standardCurve,
                    alignment: value ? Alignment.centerRight : Alignment.centerLeft,
                    child: Container(
                      width: 26,
                      height: 26,
                      decoration: BoxDecoration(color: c.surface, shape: BoxShape.circle, boxShadow: c.elevation1),
                      child: value ? KIcon(KIcons.check, size: 16, color: c.primary) : null,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Kestrel › SegmentedControl: 2–4 views of the same thing (e.g. Internal | Customer).
class KSegmented<T> extends StatelessWidget {
  const KSegmented({super.key, required this.segments, required this.value, required this.onChanged});

  final List<(T, String)> segments;
  final T value;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    return Container(
      height: 44,
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(color: c.surfaceSunken, borderRadius: BorderRadius.circular(KRadius.md)),
      child: Row(
        children: [
          for (final (v, label) in segments)
            Expanded(
              child: Semantics(
                container: true,
                selected: v == value,
                button: true,
                inMutuallyExclusiveGroup: true,
                label: label,
                onTap: () => onChanged(v),
                excludeSemantics: true,
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () {
                    if (v == value) return;
                    KHaptics.toggle();
                    onChanged(v);
                  },
                  child: AnimatedContainer(
                    duration: KMotion.of(context).quick,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: v == value ? c.surface : Colors.transparent,
                      borderRadius: BorderRadius.circular(KRadius.sm),
                      boxShadow: v == value ? c.elevation1 : null,
                    ),
                    child: Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: KType.label.copyWith(color: v == value ? c.ink : c.inkMuted),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Kestrel › Chip: a filter that can be on or off, with an optional count.
class KChip extends StatelessWidget {
  const KChip(this.label, {super.key, required this.selected, required this.onPressed, this.count, this.icon});

  final String label;
  final bool selected;
  final VoidCallback? onPressed;
  final int? count;
  final KIconData? icon;

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    final fg = selected ? c.onPrimarySoft : c.ink;
    return Pressable(
      onPressed: onPressed,
      selected: selected,
      semanticLabel: count == null ? label : '$label, $count',
      borderRadius: BorderRadius.circular(KRadius.full),
      child: AnimatedContainer(
        duration: KMotion.of(context).instant,
        height: 36,
        padding: const EdgeInsets.symmetric(horizontal: KSpace.s3),
        decoration: BoxDecoration(
          color: selected ? c.primarySoft : c.surface,
          borderRadius: BorderRadius.circular(KRadius.full),
          border: Border.all(color: selected ? c.primary : c.line),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (selected)
              Padding(
                padding: const EdgeInsets.only(right: KSpace.s1),
                child: KIcon(KIcons.check, size: 16, color: fg),
              )
            else if (icon != null)
              Padding(
                padding: const EdgeInsets.only(right: KSpace.s1),
                child: KIcon(icon!, size: 16, color: fg),
              ),
            Text(label, style: KType.labelSm.copyWith(color: fg)),
            if (count != null) Text('  $count', style: KType.labelSm.copyWith(color: c.inkMuted)),
          ],
        ),
      ),
    );
  }
}
