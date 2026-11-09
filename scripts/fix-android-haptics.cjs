const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve('node_modules/@capacitor/haptics');

const folder = path.join(
  root,
  'android/src/main/java/com/capacitorjs/plugins/haptics'
);

const implementationPath = path.join(folder, 'Haptics.java');
const pluginPath = path.join(folder, 'HapticsPlugin.java');

let implementation = fs.readFileSync(implementationPath, 'utf8');
let plugin = fs.readFileSync(pluginPath, 'utf8');

const marker =
  '// NUNO: classify selection vibration as touch feedback.';

if (implementation.includes(marker) && plugin.includes(marker)) {
  console.log('NUNO Android haptics fix already applied.');
  process.exit(0);
}

if (implementation.includes(marker) || plugin.includes(marker)) {
  throw new Error(
    'Incomplete haptics patch. Reinstall dependencies before retrying.'
  );
}

const version = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8')
).version;

if (version !== '8.0.2') {
  throw new Error(
    'Review the haptics fix for plugin version ' + version
  );
}

function replaceOnce(source, expression, replacement) {
  const matches =
    source.match(new RegExp(expression.source, 'g')) || [];

  if (matches.length !== 1) {
    throw new Error(
      'Unexpected plugin source. No files were changed.'
    );
  }

  return source.replace(expression, () => replacement);
}

implementation = replaceOnce(
  implementation,
  /import android\.os\.Build;/,
  `import android.os.Build;
import android.os.VibrationAttributes;
import android.media.AudioAttributes;`
);

implementation = replaceOnce(
  implementation,
  /    public void vibrate\(int duration\) \{[\s\S]*?\r?\n    \}/,
  `    ${marker}
    public void vibrate(int duration) {
        if (vibrator == null || !vibrator.hasVibrator()) {
            throw new IllegalStateException(
                "Android reports no available vibration motor."
            );
        }

        if (Build.VERSION.SDK_INT >= 33) {
            vibrator.vibrate(
                VibrationEffect.createOneShot(
                    duration,
                    VibrationEffect.DEFAULT_AMPLITUDE
                ),
                new VibrationAttributes.Builder()
                    .setUsage(VibrationAttributes.USAGE_TOUCH)
                    .build()
            );
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(
                VibrationEffect.createOneShot(
                    duration,
                    VibrationEffect.DEFAULT_AMPLITUDE
                ),
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            );
        } else {
            vibratePre26(duration);
        }
    }`
);

plugin = replaceOnce(
  plugin,
  /    public void vibrate\(PluginCall call\) \{[\s\S]*?\r?\n    \}/,
  `    ${marker}
    public void vibrate(PluginCall call) {
        int duration = call.getInt("duration", 300);

        if (duration < 1 || duration > 1000) {
            call.reject(
                "Vibration duration must be between 1 and 1000 milliseconds."
            );
            return;
        }

        try {
            implementation.vibrate(duration);
            call.resolve();
        } catch (RuntimeException error) {
            call.reject(
                "Android vibration error: " + error.getMessage()
            );
        }
    }`
);

fs.writeFileSync(implementationPath, implementation);
fs.writeFileSync(pluginPath, plugin);

console.log(
  'Applied NUNO touch-feedback classification and native error reporting.'
);