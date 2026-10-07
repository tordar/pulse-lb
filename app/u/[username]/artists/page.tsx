import { ListPage } from "../_lists/ListPage";

export default function ArtistsPage(props: PageProps<"/u/[username]/artists">) {
  return <ListPage kind="artists" params={props.params} searchParams={props.searchParams} />;
}
