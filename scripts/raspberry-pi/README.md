# freqhole on a raspberry pi

Raspberry Pi OS Bookworm/Trixie; arm64 charnel or arm64/armhf rathole.
run as your regular user:

```sh
curl -fsSL https://raw.githubusercontent.com/freqhole/tomb/main/scripts/raspberry-pi/setup.sh -o freqhole-setup.sh && bash freqhole-setup.sh
```

choose one app per run, optional OLED/Wi-Fi/splash, and autostart.
complete the app's first-run wizard to choose its data directory.
reopen your terminal afterward, or run `export PATH="$HOME/.local/bin:$PATH"`.

## commands

```sh
freqhole-pi                 # help; also help/-h/--help
freqhole-pi check           # check rathole releases
freqhole-pi status          # versions/update status as JSON
freqhole-pi install         # install rathole (normally called by setup)
freqhole-pi update          # update rathole
freqhole-pi attach          # attach to tmux; offer to start if stopped
freqhole-pi start           # start rathole
freqhole-pi stop            # stop rathole
freqhole-pi restart         # restart rathole
freqhole-pi enable          # select autostart entries; Enter selects all
freqhole-pi disable         # select entries to stop and disable
freqhole-pi poweroff        # shut down the Pi
freqhole-pi wifi-start      # start Wi-Fi setup; may disconnect SSH
freqhole-pi wifi-stop       # stop Wi-Fi setup

freqhole-pi check charnel
freqhole-pi status charnel
freqhole-pi update charnel
freqhole-pi recover charnel # only after an unfinished/failed update

charnel-session            # launch from the Pi desktop
freqhole-wifi info         # portal credentials
freqhole-wifi status       # service status as JSON
freqhole-wifi start        # start portal and print credentials
freqhole-wifi stop
```

tmux detach: **Ctrl+B, then D**. Wi-Fi setup is always manual-only.

automatic hooks: `freqhole-pi launch charnel` validates startup;
`freqhole-pi socket charnel` configures the selected app's OLED socket.

[setup guide](https://freqhole.net/guides/rathole-on-a-pi/) ·
[manual setup / troubleshooting](https://freqhole.net/guides/rathole-on-a-pi-manual-setup/)
