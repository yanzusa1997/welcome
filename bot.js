const fetch = (...args) =>
    import("node-fetch").then(({ default: fetch }) => fetch(...args));

// === CONFIG ===
const AUTH_TOKEN =
    "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzZXNzaW9uSUQiOiI2OGU3ZjUwMWRkOTdmYTFhZjA1ZDIwMTUiLCJ1c2Vyc0lEIjoiNjNmZDRmNGI1MzFhYjVjZTUwMmUzOGMyIiwiaWF0IjoxNzYwMDMyMDAxLCJleHAiOjE3NjEyMzIwMDF9.labScVEXPBpKNVB65eG2fCwO-Mq4vlh5D1W9zvjO2Ig"; // token kamu
const API_BASE = "https://chainers.io/api/farm";

// isi manual sesuai jumlah plot (harus urut sama urutan bed)
const seedIDs = [
    "673e0c942c7bfd708b352447", // uncommon strawberry
    "673e0c942c7bfd708b35245f", // peas
    "673e0c942c7bfd708b352441", // common strawberry
];

// === API Helpers ===
async function getGardens() {
    const res = await fetch(`${API_BASE}/user/gardens`, {
        headers: { accept: "application/json", authorization: AUTH_TOKEN },
    });
    const data = await res.json();
    if (!data.success)
        throw new Error("Gagal ambil garden: " + (data.error || "unknown"));
    return data.data[0]; // asumsi 1 garden
}

async function getInventory() {
    const res = await fetch(
        `${API_BASE}/user/inventory?sort=lastUpdated&itemType=all&sortDirection=-1&skip=0&limit=0`,
        {
            headers: { accept: "application/json", authorization: AUTH_TOKEN },
        },
    );
    const data = await res.json();
    if (!data.success)
        throw new Error("Gagal ambil inventory: " + (data.error || "unknown"));
    return data.data.items;
}

async function waitForSeed(seedID) {
    while (true) {
        const inventory = await getInventory();
        const item = inventory.find((i) => i.itemID === seedID);
        if (!item) {
            console.log(
                `⚠️ Seed ${seedID} tidak ada di inventory. Tunggu 10s...`,
            );
            await new Promise((r) => setTimeout(r, 10000));
            continue;
        }
        if (item.inventoryType === "active") {
            console.log(
                `✅ Seed ${item.itemCode} (${seedID}) ready untuk ditanam.`,
            );
            return;
        } else {
            console.log(
                `⏳ Seed ${item.itemCode} belum aktif (status=${item.inventoryType}), cek lagi 15s...`,
            );
            await new Promise((r) => setTimeout(r, 60000));
        }
    }
}

async function plantSeed(userGardensID, userBedsID, seedID) {
    await waitForSeed(seedID);
    const res = await fetch(`${API_BASE}/control/plant-seed`, {
        method: "POST",
        headers: {
            accept: "application/json",
            authorization: AUTH_TOKEN,
            "content-type": "application/json",
        },
        body: JSON.stringify({ userGardensID, userBedsID, seedID }),
    });

    const data = await res.json();
    if (!data.success) {
        console.log(`❌ Plant gagal di bed ${userBedsID}:`, data.error);
        return null;
    }
    console.log(`🌱 Plant ${data.data.seedCode} di bed ${userBedsID} sukses.`);
    return {
        bed: userBedsID,
        userFarmingID: data.data.userFarmingID,
        growthTime: data.data.growthTime,
        seedCode: data.data.seedCode,
    };
}

async function harvestSeed(userFarmingID, bed) {
    const res = await fetch(`${API_BASE}/control/collect-harvest`, {
        method: "POST",
        headers: {
            accept: "application/json",
            authorization: AUTH_TOKEN,
            "content-type": "application/json",
        },
        body: JSON.stringify({ userFarmingID }),
    });

    const data = await res.json();
    if (!data.success) {
        console.log(`❌ Harvest gagal di bed ${bed}:`, data.error);
        return;
    }
    const harvest = data.data.harvest?.[0];
    if (harvest) {
        console.log(`✅ Harvest bed ${bed}: ${harvest.type} x${harvest.count}`);
    } else {
        console.log(`⚠️ Harvest bed ${bed}: tidak ada hasil.`);
    }
}

// === CEK AWAL ===
async function initialCheck(userGardensID, beds) {
    console.log("🔍 Cek kondisi awal semua bed...\n");

    for (const bed of beds) {
        const farming = bed.currentFarming;
        if (farming) {
            const { userFarmingID, plantedAt, growthTime } = farming;
            const harvestTime =
                new Date(plantedAt).getTime() + growthTime * 1000;

            if (Date.now() >= harvestTime) {
                console.log(`🌾 Bed ${bed.userBedsID} sudah siap panen!`);
                await harvestSeed(userFarmingID, bed.userBedsID);
                await new Promise((r) => setTimeout(r, 1000));
            } else {
                const sisa = Math.floor((harvestTime - Date.now()) / 1000);
                console.log(
                    `⏳ Bed ${bed.userBedsID} belum matang (${sisa}s lagi)`,
                );
            }
        } else {
            console.log(`🪴 Bed ${bed.userBedsID} kosong, siap ditanam.`);
        }
    }

    console.log("\n✅ Cek awal selesai.\n");
}

// === MAIN LOOP ===
async function startBot() {
    while (true) {
        try {
            const garden = await getGardens();
            const userGardensID = garden.userGardensID;
            const beds = garden.placedBeds;

            // 🔁 Cek & harvest dulu sebelum tanam
            await initialCheck(userGardensID, beds);

            let planted = [];
            for (let i = 0; i < beds.length && i < seedIDs.length; i++) {
                const bed = beds[i];
                if (bed.currentFarming) continue; // skip bed yang sedang tumbuh

                const seedID = seedIDs[i];
                const result = await plantSeed(userGardensID, bed.userBedsID, seedID);
                if (result) planted.push(result);
                await new Promise((r) => setTimeout(r, 1000));
            }

            if (planted.length === 0) {
                console.log("⚠️ Tidak ada yang berhasil ditanam, retry...");
                await new Promise((r) => setTimeout(r, 5000));
                continue;
            }

            const harvestQueue = planted.map((p) => ({
                ...p,
                harvestTime: Date.now() + p.growthTime * 1000,
            }));

            console.log(`⏳ Menunggu ${planted.length} tanaman matang...`);
            planted.forEach((p) => {
                console.log(`   - ${p.seedCode}: ${p.growthTime}s`);
            });

            while (harvestQueue.length > 0) {
                const now = Date.now();
                const readyToHarvest = [];

                for (let i = harvestQueue.length - 1; i >= 0; i--) {
                    if (now >= harvestQueue[i].harvestTime) {
                        readyToHarvest.push(harvestQueue[i]);
                        harvestQueue.splice(i, 1);
                    }
                }

                for (let p of readyToHarvest) {
                    await harvestSeed(p.userFarmingID, p.bed);
                    await new Promise((r) => setTimeout(r, 1000));
                }

                if (harvestQueue.length > 0) {
                    const nextHarvest = Math.min(
                        ...harvestQueue.map((p) => p.harvestTime),
                    );
                    const waitTime = Math.min(nextHarvest - Date.now(), 5000);
                    if (waitTime > 0) {
                        await new Promise((r) => setTimeout(r, waitTime));
                    }
                }
            }

            console.log("🔄 Ulangi siklus...\n");
        } catch (err) {
            console.error("❌ Runtime error:", err.message);
            await new Promise((r) => setTimeout(r, 5000));
        }
    }
}

startBot();
