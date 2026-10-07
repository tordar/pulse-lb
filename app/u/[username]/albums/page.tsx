import { ListPage } from "../_lists/ListPage";

export default function AlbumsPage(props: PageProps<"/u/[username]/albums">) {
  return <ListPage kind="albums" params={props.params} searchParams={props.searchParams} />;
}
