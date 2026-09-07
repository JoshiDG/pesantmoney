import { useState } from "react";
import "./App.css";
import { AccountsScreen } from "./accounts/AccountsScreen";
import { Account } from "./accounts/types";
import { TransactionsScreen } from "./transactions/TransactionsScreen";

function App() {
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);

  return (
    <main className="container">
      <h1>PesantMoney</h1>
      {selectedAccount ? (
        <TransactionsScreen
          account={selectedAccount}
          onBack={() => setSelectedAccount(null)}
        />
      ) : (
        <AccountsScreen onSelectAccount={setSelectedAccount} />
      )}
    </main>
  );
}

export default App;
