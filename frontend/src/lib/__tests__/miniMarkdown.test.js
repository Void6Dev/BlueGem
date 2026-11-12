import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderMarkdown } from "@/lib/miniMarkdown";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Ссылка [[узел]] должна вести к узлу и после того, как разбор закончился:
// раньше обработчик читал общую переменную разбора в момент нажатия, когда
// она уже была сброшена, — и нажатие не делало ничего.
test("нажатие на [[ссылку]] открывает узел, на несуществующую — предлагает завести", () => {
  const open = jest.fn();
  const create = jest.fn();
  const tree = renderMarkdown("Порт у [[Громовая долина|долины]] и [[Нигде]].", {
    doc: true,
    nodesByTitle: { "громовая долина": "vale" },
    onOpenNode: open,
    onCreateNode: create,
  });
  // Второй разбор (как на карточке холста) сбрасывает общее состояние.
  renderMarkdown("ещё текст");

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(<div>{tree}</div>); });
  const [link, missing] = host.querySelectorAll("button");
  expect(link.textContent).toBe("долины");
  act(() => { link.click(); });
  expect(open).toHaveBeenCalledWith("vale");
  act(() => { missing.click(); });
  expect(create).toHaveBeenCalledWith("Нигде");
  act(() => root.unmount());
});
