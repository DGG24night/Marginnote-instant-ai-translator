import { Route, Routes } from "react-router-dom";
import SettingsPage from "./pages/SettingsPage";
import CardPage from "./pages/CardPage";

function App() {
  return (
    <Routes>
      <Route path="/" element={<SettingsPage />} />
      <Route path="/card" element={<CardPage />} />
    </Routes>
  );
}

export default App;
