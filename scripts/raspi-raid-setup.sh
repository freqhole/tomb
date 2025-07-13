#!/bin/bash

set -e

# === CONFIGURATION ===
RAID_DEV="/dev/md0"
MOUNT_POINT="/mnt/freqraid"
ARRAY_NAME="freqraid"
DISKS=("/dev/nvme0n1" "/dev/nvme1n1" "/dev/nvme2n1" "/dev/nvme3n1")


# === STEP 1: Install mdadm ===
# echo "Installing mdadm..."
# sudo apt update
# sudo apt install -y mdadm

# === STEP 2: Create RAID 5 Array ===
# echo "Creating RAID 5 array..."
# sudo mdadm --create --verbose $RAID_DEV --level=5 --raid-devices=4 "${DISKS[@]}"

# === STEP 3: Save RAID configuration ===
# echo "Saving mdadm configuration..."
# sudo mkdir -p /etc/mdadm
# sudo mdadm --detail --scan | sudo tee /etc/mdadm/mdadm.conf
# sudo update-initramfs -u

# # === STEP 4: Wait for RAID sync (can run in background) ===
# echo "RAID sync in progress... monitor with: cat /proc/mdstat"

# # === STEP 5: Format the new array ===
# echo "Formatting RAID array with ext4..."
# sudo mkfs.ext4 -F $RAID_DEV

# # === STEP 6: Mount the RAID array ===
echo "Creating mount point and mounting..."
sudo mkdir -p $MOUNT_POINT
UUID=$(sudo blkid -s UUID -o value $RAID_DEV)
echo "UUID=$UUID $MOUNT_POINT ext4 defaults,nofail,discard 0 0" | sudo tee -a /etc/fstab
sudo mount -a

echo "RAID 5 setup complete! Array mounted at $MOUNT_POINT"
