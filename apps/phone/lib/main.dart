import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/app.dart';
import 'core/push.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Push.init(); // quietly off when Firebase isn't set up for this build
  runApp(const ProviderScope(child: RfqDeskApp()));
}
