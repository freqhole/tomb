---
"freqhole-release": patch
---

pi setup + charnel player polish

pi setup turns off the red power LED, can set up a GPIO fan with speed
control (default pin 14) and unattended-upgrades, and adds
`freqhole-setup.sh uninstall`. player pairing now stays on after updates,
because the config template was missing [player_pairing]. the OLED menu
stays awake during updates and shows progress with "do not power off!",
shows "playing..."/"paused!" briefly after play/pause, yank
"see logs". charnel hides the cursor on linux even when booted without a
mouse, and the expanded mini video player hides its buttons and the cursor
when the pointer is idle.
