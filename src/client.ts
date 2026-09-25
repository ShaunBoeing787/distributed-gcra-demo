const baseUrls = (process.env.REPLICAS ?? "http://localhost:3000,http://localhost:3001").split(",");
const attempts = Number(process.env.ATTEMPTS ?? 10);

async function main() {
  for (let i = 0; i < attempts; i++) {
    const url = baseUrls[i % baseUrls.length].replace(/\/$/, "") + "/limited";
    const response = await fetch(url);
    const body = await response.json();
    console.log(`${i + 1}. ${response.status} ${JSON.stringify(body)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
