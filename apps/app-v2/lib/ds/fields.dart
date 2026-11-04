import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'package:intl/intl.dart';

import '../core/json.dart';
import '../core/scope.dart';
import '../generated/countries.g.dart';
import 'theme.dart';

enum FieldKind { text, multiline, email, phone, country, integer, decimal, toggle, date, choice, pick }

/// One field of a form, as the spec describes it. Generated as `<Entity>Fields.<name>`.
class FieldDef {
  const FieldDef(this.key, this.label, this.kind,
      {this.required = false,
      this.max,
      this.hint,
      this.upper = false,
      this.options = const {},
      this.defaultValue,
      this.source,
      this.suggestions = const [],
      this.showIf});

  final String key, label;
  final FieldKind kind;
  final bool required;
  final int? max;
  final String? hint;
  final bool upper;

  /// value → label, for choices.
  final Map<String, String> options;
  final String? defaultValue;

  /// pick: where the choices come from: an API list of `{id, name}`, or "settings:sales.categories".
  final String? source;

  /// Quick answers shown as chips under a text field ("Workload", "Person is away").
  final List<String> suggestions;

  /// Shown only when this says so (e.g. the rate when two currencies differ). Hidden fields are not checked or sent.
  final bool Function(Map<String, Object?> values)? showIf;

  bool shownIn(Map<String, Object?> values) => showIf?.call(values) ?? true;

  /// The same field with a few things changed (e.g. a narrower [showIf]).
  FieldDef copyWith({String? label, bool? required, String? hint, Map<String, String>? options, bool Function(Map<String, Object?>)? showIf}) =>
      FieldDef(key, label ?? this.label, kind,
          required: required ?? this.required,
          max: max,
          hint: hint ?? this.hint,
          upper: upper,
          options: options ?? this.options,
          defaultValue: defaultValue,
          source: source,
          suggestions: suggestions,
          showIf: showIf ?? this.showIf);

  static final _email = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');

  /// The problem with [v], or null when it is fine.
  String? check(Object? v) {
    final s = v is String ? v.trim() : v;
    final empty = s == null || s == '' || (kind == FieldKind.toggle && s == false);
    if (empty) return required && kind != FieldKind.toggle ? '$label is needed' : null;
    if (s is String) {
      if (max != null && s.length > max!) return '$label: at most $max characters';
      if (kind == FieldKind.email && !_email.hasMatch(s)) return 'Enter an email like name@company.com';
      if (kind == FieldKind.phone && s.replaceAll(RegExp(r'\D'), '').length < 7) return 'Enter the full number with the country code';
      if (kind == FieldKind.integer && int.tryParse(s) == null) return 'Enter a whole number';
      if (kind == FieldKind.decimal && num.tryParse(s) == null) return 'Enter a number';
    }
    return null;
  }
}

/// At least one of [keys] must have a value; the message shows under the first.
class AnyOf {
  const AnyOf(this.keys, this.message);
  final List<String> keys;
  final String message;

  bool ok(Map<String, Object?> values) => keys.any((k) {
        final v = values[k];
        return v != null && (v is! String || v.trim().isNotEmpty) && (v is! List || v.isNotEmpty);
      });
}

/// The editor for one field. Labels sit above the box, like on the web.
class FieldEditor extends StatefulWidget {
  const FieldEditor({super.key, required this.def, required this.value, required this.onChanged, this.error});
  final FieldDef def;
  final Object? value;
  final ValueChanged<Object?> onChanged;
  final String? error;

  @override
  State<FieldEditor> createState() => _FieldEditorState();
}

class _FieldEditorState extends State<FieldEditor> {
  late final _ctl = TextEditingController(text: _text(widget.value));

  static String _text(Object? v) => v == null ? '' : '$v';

  @override
  void didUpdateWidget(FieldEditor old) {
    super.didUpdateWidget(old);
    // Filled in from another field (e.g. the rate after the currency changed).
    final next = _text(widget.value);
    if (widget.value != old.value && next != _ctl.text) _ctl.text = next;
  }

  @override
  void dispose() {
    _ctl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final d = widget.def;
    final c = context.colors;
    final label = Row(children: [
      Flexible(child: Text(d.label, style: context.text.labelMedium)),
      if (!d.required && d.defaultValue == null && d.kind != FieldKind.toggle && d.kind != FieldKind.choice)
        Text('  optional', style: context.text.labelSmall?.copyWith(color: c.muted, fontWeight: FontWeight.w400)),
    ]);
    if (d.kind == FieldKind.toggle) {
      return MergeSemantics(
        child: SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(d.label, style: context.text.bodyMedium),
          value: widget.value == true,
          onChanged: widget.onChanged,
        ),
      );
    }
    final Widget input = switch (d.kind) {
      FieldKind.choice => _choice(context),
      FieldKind.country => _country(context),
      FieldKind.pick => _pick(context),
      FieldKind.date => _date(context),
      _ => TextField(
          controller: _ctl,
          onChanged: (v) => widget.onChanged(d.upper ? v.toUpperCase() : v),
          keyboardType: switch (d.kind) {
            FieldKind.email => TextInputType.emailAddress,
            FieldKind.phone => TextInputType.phone,
            FieldKind.integer => TextInputType.number,
            FieldKind.decimal => const TextInputType.numberWithOptions(decimal: true),
            FieldKind.multiline => TextInputType.multiline,
            _ => TextInputType.text,
          },
          textCapitalization: d.upper
              ? TextCapitalization.characters
              : d.kind == FieldKind.text || d.kind == FieldKind.multiline
                  ? TextCapitalization.sentences
                  : TextCapitalization.none,
          autocorrect: d.kind == FieldKind.multiline,
          minLines: d.kind == FieldKind.multiline ? 3 : 1,
          maxLines: d.kind == FieldKind.multiline ? 8 : 1,
          inputFormatters: [if (d.max != null) LengthLimitingTextInputFormatter(d.max)],
          decoration: InputDecoration(
            errorText: widget.error,
            helperText: d.hint,
            semanticCounterText: '',
          ),
        ),
    };
    return Semantics(
      label: d.label,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
        ExcludeSemantics(child: label),
        const SizedBox(height: 6),
        input,
        if (d.suggestions.isNotEmpty) ...[
          const SizedBox(height: Gap.sm),
          Wrap(spacing: Gap.sm, runSpacing: Gap.xs, children: [
            for (final s in d.suggestions)
              ActionChip(
                label: Text(s),
                onPressed: () {
                  _ctl.text = s;
                  widget.onChanged(s);
                },
              ),
          ]),
        ],
        if (widget.error != null && const {FieldKind.choice, FieldKind.country, FieldKind.pick, FieldKind.date}.contains(d.kind)) ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(Gap.md, 6, Gap.md, 0),
            child: Text(widget.error!, style: context.text.bodySmall?.copyWith(color: c.bad)),
          ),
        ],
      ]),
    );
  }

  /// Up to eight options: chips, all visible. More: the first seven as chips (the chosen one too)
  /// and "More…" for a searchable list of all.
  Widget _choice(BuildContext context) {
    final d = widget.def;
    final all = d.options.entries.toList();
    final shown = all.length <= 8 ? all : [...all.take(7), ...all.skip(7).where((e) => e.key == widget.value)];
    return Wrap(spacing: Gap.sm, runSpacing: Gap.sm, children: [
      for (final e in shown)
        ChoiceChip(label: Text(e.value), selected: widget.value == e.key, onSelected: (_) => widget.onChanged(e.key)),
      if (all.length > 8)
        ActionChip(
          avatar: const Icon(Icons.expand_more, size: 18),
          label: const Text('More…'),
          tooltip: 'All ${all.length} choices for ${d.label}',
          onPressed: () async {
            final picked = await pickFrom(context, title: d.label, options: d.options);
            if (picked != null) widget.onChanged(picked);
          },
        ),
    ]);
  }

  Widget _country(BuildContext context) {
    final c = context.colors;
    final code = widget.value as String?;
    final name = countryName(code);
    return InkWell(
      borderRadius: BorderRadius.circular(Gap.radiusSm),
      onTap: () async {
        final picked = await pickCountry(context);
        if (picked != null) widget.onChanged(picked);
      },
      child: InputDecorator(
        decoration: InputDecoration(
          suffixIcon: const Icon(Icons.expand_more),
          enabledBorder: widget.error == null ? null : OutlineInputBorder(borderSide: BorderSide(color: c.bad)),
        ),
        child: Text(name ?? 'Choose a country', style: context.text.bodyLarge?.copyWith(color: name == null ? c.muted : c.text)),
      ),
    );
  }
}

extension on _FieldEditorState {
  /// A box that opens a chooser; shows the chosen label or a hint.
  Widget _box(BuildContext context, {required String? shown, required String hint, required IconData icon, required VoidCallback onTap}) {
    final c = context.colors;
    return InkWell(
      borderRadius: BorderRadius.circular(Gap.radiusSm),
      onTap: onTap,
      child: InputDecorator(
        decoration: InputDecoration(
          suffixIcon: Icon(icon),
          enabledBorder: widget.error == null ? null : OutlineInputBorder(borderSide: BorderSide(color: c.bad)),
        ),
        child: Text(shown ?? hint, style: context.text.bodyLarge?.copyWith(color: shown == null ? c.muted : c.text)),
      ),
    );
  }

  Widget _pick(BuildContext context) {
    final d = widget.def;
    return FutureBuilder<Map<String, String>>(
      future: Choices.of(context, d.source!),
      builder: (context, snap) {
        final options = snap.data ?? const <String, String>{};
        final v = widget.value as String?;
        return _box(
          context,
          shown: v == null || v.isEmpty ? null : options[v] ?? (snap.hasData ? v : '…'),
          hint: 'Choose',
          icon: Icons.expand_more,
          onTap: () async {
            final picked = await pickFrom(context, title: d.label, options: options);
            if (picked != null) widget.onChanged(picked);
          },
        );
      },
    );
  }

  Widget _date(BuildContext context) {
    final v = widget.value is String ? DateTime.tryParse(widget.value as String) : null;
    return _box(
      context,
      shown: v == null ? null : DateFormat('d MMM yyyy').format(v),
      hint: 'Choose a date',
      icon: Icons.calendar_today_outlined,
      onTap: () async {
        final now = DateTime.now();
        final picked = await showDatePicker(
          context: context,
          initialDate: v ?? now,
          firstDate: DateTime(now.year - 5),
          lastDate: DateTime(now.year + 5),
        );
        if (picked != null) widget.onChanged(picked.toIso8601String().substring(0, 10));
      },
    );
  }
}

/// Choices loaded once per source and kept while the app runs.
abstract final class Choices {
  static final _cache = <String, Future<Map<String, String>>>{};

  static Future<Map<String, String>> of(BuildContext context, String source) {
    final api = context.api;
    // Per sign-in: another person or company sees other choices.
    return _cache.putIfAbsent('${api.token}|$source', () async {
      try {
        if (source.startsWith('settings:')) {
          Object? v = await api.get('/api/settings');
          for (final p in source.substring(9).split('.')) {
            v = v is Map<String, dynamic> ? v[p] : null;
          }
          return {for (final x in (v as List<dynamic>? ?? const [])) '$x': '$x'};
        }
        return {for (final r in await api.getList(source)) r.str('id'): r.str('name')};
      } catch (_) {
        _cache.remove('${api.token}|$source'); // try again next time
        return const {};
      }
    });
  }

  /// Forget everything, e.g. after signing out.
  static void clear() => _cache.clear();
}

/// A searchable list of choices in a sheet; the chosen key, or null.
Future<String?> pickFrom(BuildContext context, {required String title, required Map<String, String> options}) =>
    showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      useRootNavigator: true,
      builder: (ctx) => _ChoiceSheet(title: title, options: options),
    );

class _ChoiceSheet extends StatefulWidget {
  const _ChoiceSheet({required this.title, required this.options});
  final String title;
  final Map<String, String> options;

  @override
  State<_ChoiceSheet> createState() => _ChoiceSheetState();
}

class _ChoiceSheetState extends State<_ChoiceSheet> {
  String q = '';

  @override
  Widget build(BuildContext context) {
    final rows = widget.options.entries.where((e) => q.isEmpty || e.value.toLowerCase().contains(q)).toList();
    return SizedBox(
      height: MediaQuery.sizeOf(context).height * 0.85,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.sm),
          child: Semantics(header: true, child: Text(widget.title, style: context.text.titleLarge)),
        ),
        if (widget.options.length > 8)
          Padding(
            padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.sm),
            child: TextField(
              autofocus: true,
              onChanged: (v) => setState(() => q = v.trim().toLowerCase()),
              decoration: const InputDecoration(hintText: 'Search', prefixIcon: Icon(Icons.search)),
            ),
          ),
        Expanded(
          child: rows.isEmpty
              ? Center(child: Text('Nothing to choose', style: context.text.bodySmall))
              : ListView.builder(
                  itemCount: rows.length,
                  itemBuilder: (ctx, i) => ListTile(
                    minTileHeight: Gap.tap,
                    title: Text(rows[i].value),
                    onTap: () => Navigator.pop(ctx, rows[i].key),
                  ),
                ),
        ),
      ]),
    );
  }
}

/// A searchable list of countries in a sheet. The ISO code, or null when closed.
Future<String?> pickCountry(BuildContext context) => showModalBottomSheet<String>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (ctx) => const _CountrySheet(),
    );

class _CountrySheet extends StatefulWidget {
  const _CountrySheet();

  @override
  State<_CountrySheet> createState() => _CountrySheetState();
}

class _CountrySheetState extends State<_CountrySheet> {
  String q = '';

  @override
  Widget build(BuildContext context) {
    final rows = countries.entries
        .where((e) => q.isEmpty || e.value.toLowerCase().contains(q) || e.key.toLowerCase() == q)
        .toList()
      ..sort((a, b) => a.value.compareTo(b.value));
    return SizedBox(
      height: MediaQuery.sizeOf(context).height * 0.85,
      child: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.sm),
          child: TextField(
            autofocus: true,
            onChanged: (v) => setState(() => q = v.trim().toLowerCase()),
            decoration: const InputDecoration(hintText: 'Search countries', prefixIcon: Icon(Icons.search)),
          ),
        ),
        Expanded(
          child: ListView.builder(
            itemCount: rows.length,
            itemBuilder: (ctx, i) => ListTile(
              minTileHeight: Gap.tap,
              title: Text(rows[i].value),
              trailing: Text(rows[i].key, style: ctx.text.bodySmall?.copyWith(color: ctx.colors.muted)),
              onTap: () => Navigator.pop(ctx, rows[i].key),
            ),
          ),
        ),
      ]),
    );
  }
}
