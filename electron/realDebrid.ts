export type FetchLike = typeof fetch;

const apiError = async (response: Response) => {
  const body = await response.text();
  throw new Error(`${response.status} ${body.slice(0, 240)}`);
};

export async function addTorrent(
  token: string,
  torrent: Uint8Array,
  fetchImpl: FetchLike = fetch,
) {
  const response = await fetchImpl("https://api.real-debrid.com/rest/1.0/torrents/addTorrent", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-bittorrent",
    },
    body: torrent,
  });
  if (!response.ok) await apiError(response);
  return String(((await response.json()) as { id: string | number }).id);
}
