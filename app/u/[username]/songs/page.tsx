import { ListPage } from "../_lists/ListPage";

export default function SongsPage(props: PageProps<"/u/[username]/songs">) {
  return <ListPage kind="songs" params={props.params} searchParams={props.searchParams} />;
}
