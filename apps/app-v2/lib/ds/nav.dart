import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';

/// Opens a page on top of the current one (Back returns here).
void openPage(BuildContext context, String path) => context.push(path);
