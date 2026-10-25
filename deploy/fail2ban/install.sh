#!/bin/sh
# Installe fail2ban et le relevé « Sécurité » sur l'hôte Docker du site Révision CEB.
# Usage (root, depuis la racine du dépôt, conteneur démarré) :  sh deploy/fail2ban/install.sh
#   CEB_CONTAINER=revision-ceb   nom du conteneur (défaut)
#   EXTRA_IGNORE="192.168.1.0/24" adresses à ne jamais bloquer (ex. le réseau de la maison)
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
CT=${CEB_CONTAINER:-revision-ceb}
EXTRA_IGNORE=${EXTRA_IGNORE:-}

DATA=$(docker inspect "$CT" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}')
[ -n "$DATA" ] || { echo "volume /data du conteneur $CT introuvable" >&2; exit 1; }
SEC="$DATA/security"
GW=$(docker inspect "$CT" --format '{{range .NetworkSettings.Networks}}{{.Gateway}} {{end}}')
mkdir -p "$SEC"
[ -e "$SEC/auth.log" ] || { touch "$SEC/auth.log"; chown 1000 "$SEC" "$SEC/auth.log"; }

apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq fail2ban python3-systemd >/dev/null

install -m 644 "$HERE/filter.d/ceb-auth.conf" /etc/fail2ban/filter.d/ceb-auth.conf
sed -e "s#@LOGPATH@#$SEC/auth.log#" -e "s#@DOCKER_GW@#$GW#" -e "s#@EXTRA_IGNORE@#$EXTRA_IGNORE#" \
    "$HERE/jail.d/ceb.local" > /etc/fail2ban/jail.d/ceb.local
# Debian 12 : la prison sshd par défaut lit /var/log/auth.log (absent sans rsyslog) — ceb.local passe sur journald
install -m 755 "$HERE/ceb-f2b-status" /usr/local/sbin/ceb-f2b-status
echo "CEB_SEC_DIR=$SEC" > /etc/default/ceb-f2b
install -m 644 "$HERE/systemd/ceb-f2b-status.service" "$HERE/systemd/ceb-f2b-status.timer" /etc/systemd/system/
sed "s#@SEC_DIR@#$SEC#" "$HERE/systemd/ceb-f2b-status.path" > /etc/systemd/system/ceb-f2b-status.path
cat > /etc/logrotate.d/ceb-auth <<LR
$SEC/auth.log {
    weekly
    rotate 8
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
LR

fail2ban-client -t >/dev/null
systemctl daemon-reload
systemctl enable --now fail2ban
systemctl restart fail2ban
systemctl enable --now ceb-f2b-status.timer ceb-f2b-status.path
sleep 3
/usr/local/sbin/ceb-f2b-status
fail2ban-client status
echo "OK — état écrit dans $SEC/fail2ban.json (onglet Parents → Sécurité)"
