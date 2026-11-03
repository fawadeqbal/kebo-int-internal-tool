import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/json.dart';
import '../core/scope.dart';
import 'fields.dart';
import 'theme.dart';
import 'tone.dart';
import 'widgets.dart';

/// Repeating items inside a form, e.g. a customer's contacts.
class ListDef {
  const ListDef(this.key,
      {required this.itemLabel, required this.addLabel, required this.fields, required this.blank, this.min = 0, this.rules = const []});
  final String key, itemLabel, addLabel;
  final int min;
  final List<FieldDef> fields;
  final List<AnyOf> rules;
  final Json Function() blank;
}

/// A group of fields under an optional title; [folded] groups start closed.
class FormGroup {
  const FormGroup({this.title, this.fields = const [], this.list, this.folded = false});
  final String? title;
  final List<FieldDef> fields;
  final ListDef? list;
  final bool folded;
}

/// Every add and edit: a sheet from the bottom with labelled fields and one Save.
class FormSheet extends StatefulWidget {
  const FormSheet._({
    required this.title,
    required this.save,
    required this.groups,
    required this.initial,
    required this.send,
    this.rules = const [],
    this.duplicateFlag,
  });

  final String title, save;
  final List<FormGroup> groups;
  final List<AnyOf> rules;
  final Json initial;
  final Future<Object?> Function(Api api, Json body) send;

  /// When the server answers 409 "duplicate", the matches are shown and
  /// "Save anyway" sends again with this flag set.
  final String? duplicateFlag;

  /// Shows the form; true when it was saved.
  static Future<bool> open(
    BuildContext context, {
    required String title,
    required String save,
    required List<FormGroup> groups,
    required Json initial,
    required Future<Object?> Function(Api api, Json body) send,
    List<AnyOf> rules = const [],
    String? duplicateFlag,
  }) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      useRootNavigator: true,
      isDismissible: false,
      builder: (_) => FormSheet._(
        title: title,
        save: save,
        groups: groups,
        initial: initial,
        send: send,
        rules: rules,
        duplicateFlag: duplicateFlag,
      ),
    );
    return saved ?? false;
  }

  @override
  State<FormSheet> createState() => _FormSheetState();
}

class _FormSheetState extends State<FormSheet> {
  late final Json values = _copy(widget.initial);
  late final Set<String> open = {for (final g in widget.groups) if (!g.folded && g.title != null) g.title!};
  final errors = <String, String>{};
  String? problem;
  bool busy = false;
  bool changed = false;

  static Json _copy(Json j) => {
        for (final e in j.entries)
          e.key: e.value is List ? [for (final x in e.value as List<dynamic>) x is Json ? _copy(x) : x] : e.value,
      };

  List<Json> _items(String key) => [for (final x in (values[key] as List<dynamic>? ?? const [])) x as Json];

  void _set(Json target, String key, Object? v) => setState(() {
        target[key] = v;
        changed = true;
      });

  /// Checks everything; fills [errors] and opens the groups that have one.
  bool _check() {
    errors.clear();
    void checkFields(Json src, List<FieldDef> defs, List<AnyOf> rules, String prefix) {
      for (final d in defs) {
        final e = d.check(src[d.key]);
        if (e != null) errors['$prefix${d.key}'] = e;
      }
      for (final r in rules) {
        if (!r.ok(src)) errors.putIfAbsent('$prefix${r.keys.first}', () => r.message);
      }
    }

    for (final g in widget.groups) {
      if (g.list != null) {
        final items = _items(g.list!.key);
        if (items.length < g.list!.min) errors[g.list!.key] = 'Add at least ${g.list!.min} ${g.list!.itemLabel.toLowerCase()}';
        for (final (i, item) in items.indexed) {
          checkFields(item, g.list!.fields, g.list!.rules, '${g.list!.key}.$i.');
        }
      } else {
        checkFields(values, g.fields, const [], '');
      }
    }
    checkFields(values, const [], widget.rules, '');
    for (final g in widget.groups) {
      final keys = g.list != null ? [g.list!.key] : g.fields.map((f) => f.key);
      if (g.title != null && errors.keys.any((k) => keys.any((f) => k == f || k.startsWith('$f.')))) open.add(g.title!);
    }
    return errors.isEmpty;
  }

  Future<void> _save({bool anyway = false}) async {
    if (busy) return;
    final ok = _check();
    setState(() => problem = ok ? null : 'Some details need fixing. They are marked below.');
    if (!ok) return;
    setState(() => busy = true);
    final body = _copy(values);
    for (final e in body.entries.toList()) {
      if (e.value is String) body[e.key] = (e.value as String).trim();
    }
    if (anyway && widget.duplicateFlag != null) body[widget.duplicateFlag!] = true;
    try {
      await widget.send(context.api, body);
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        busy = false;
        errors.addAll(e.fieldErrors);
        problem = e.message;
      });
      if (e.code == 'duplicate' && widget.duplicateFlag != null) {
        final lines = e.matches.map((m) => '• ${m.str('label')} — ${m.str('detail')}').join('\n');
        final go = await confirmDialog(context, title: 'Already known?', text: '${e.message}\n\n$lines', yes: 'Save anyway');
        if (go && mounted) await _save(anyway: true);
      }
    }
  }

  Future<void> _close() async {
    if (!changed || await confirmDialog(context, title: 'Discard changes?', text: 'What you typed is not saved.', yes: 'Discard', danger: true)) {
      if (mounted) Navigator.pop(context, false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final inset = MediaQuery.viewInsetsOf(context).bottom;
    return PopScope(
      canPop: !changed,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _close();
      },
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * 0.92,
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.xs, Gap.xs),
            child: Row(children: [
              Expanded(child: Semantics(header: true, child: Text(widget.title, style: context.text.titleLarge))),
              IconButton(icon: const Icon(Icons.close), tooltip: 'Close', onPressed: _close),
            ]),
          ),
          Divider(height: 1, color: c.line),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(Gap.lg),
              children: [
                if (problem != null) ...[MessageBanner(problem!, tone: Tone.bad), const SizedBox(height: Gap.lg)],
                for (final g in widget.groups) ..._group(context, g),
              ],
            ),
          ),
          Container(
            padding: EdgeInsets.fromLTRB(Gap.lg, Gap.md, Gap.lg, Gap.md + (inset > 0 ? 0 : MediaQuery.paddingOf(context).bottom)),
            decoration: BoxDecoration(color: c.surface, border: Border(top: BorderSide(color: c.line))),
            child: SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: busy ? null : _save,
                child: busy
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : Text(widget.save),
              ),
            ),
          ),
        ]),
      ),
    );
  }

  List<Widget> _group(BuildContext context, FormGroup g) {
    final c = context.colors;
    final body = <Widget>[];
    if (g.list != null) {
      final l = g.list!;
      final items = _items(l.key);
      if (errors[l.key] != null) body.add(Text(errors[l.key]!, style: context.text.bodySmall?.copyWith(color: c.bad)));
      for (final (i, item) in items.indexed) {
        body.add(Container(
          margin: const EdgeInsets.only(bottom: Gap.md),
          padding: const EdgeInsets.fromLTRB(Gap.md, Gap.xs, Gap.md, Gap.md),
          decoration: BoxDecoration(border: Border.all(color: c.line), borderRadius: BorderRadius.circular(Gap.radius)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              Expanded(child: Text('${l.itemLabel} ${i + 1}', style: context.text.labelMedium?.copyWith(color: c.text2))),
              if (items.length > l.min)
                TextButton(
                  onPressed: () => setState(() {
                    (values[l.key] as List<dynamic>).removeAt(i);
                    changed = true;
                  }),
                  child: Text('Remove', style: TextStyle(color: c.bad)),
                ),
            ]),
            for (final d in l.fields) ...[
              FieldEditor(
                key: ValueKey('${l.key}.${identityHashCode(item)}.${d.key}'),
                def: d,
                value: item[d.key],
                error: errors['${l.key}.$i.${d.key}'],
                onChanged: (v) => _set(item, d.key, v),
              ),
              const SizedBox(height: Gap.md),
            ],
          ]),
        ));
      }
      body.add(Align(
        alignment: Alignment.centerLeft,
        child: OutlinedButton.icon(
          icon: const Icon(Icons.add, size: 18),
          label: Text(l.addLabel),
          onPressed: () => setState(() {
            values[l.key] = [..._items(l.key), l.blank()];
            changed = true;
          }),
        ),
      ));
    } else {
      for (final d in g.fields) {
        body
          ..add(FieldEditor(def: d, value: values[d.key], error: errors[d.key], onChanged: (v) => _set(values, d.key, v)))
          ..add(const SizedBox(height: Gap.lg));
      }
    }
    if (g.title == null) return body;
    final isOpen = open.contains(g.title);
    return [
      const SizedBox(height: Gap.xs),
      Semantics(
        header: true,
        expanded: g.folded ? isOpen : null,
        child: InkWell(
          onTap: g.folded ? () => setState(() => isOpen ? open.remove(g.title) : open.add(g.title!)) : null,
          child: SizedBox(
            height: Gap.tap,
            child: Row(children: [
              Expanded(child: Text(g.title!, style: context.text.titleMedium)),
              if (g.folded) Icon(isOpen ? Icons.expand_less : Icons.expand_more, color: c.text2),
            ]),
          ),
        ),
      ),
      if (!g.folded || isOpen) ...body else const SizedBox(height: Gap.sm),
    ];
  }
}
